import asyncio
from pathlib import Path
import re
import struct
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

import av
from pymobiledevice3.remote.core_device.screen_stream import hevc_decoder_configuration_record

from mirros.video import (
    SoftwareYuvDecoder,
    extract_i420_planes,
    pack_yuv_frame,
    software_yuv_stream,
)


def hevc_fixture(width=320, height=640):
    encoder = av.CodecContext.create('libx265', 'w')
    encoder.width, encoder.height, encoder.pix_fmt = width, height, 'yuv420p'
    encoder.options = {
        'preset': 'ultrafast',
        'tune': 'zerolatency',
        'x265-params': 'log-level=error:bframes=0:repeat-headers=1',
    }
    frame = av.VideoFrame(width, height, 'yuv420p')
    for plane in frame.planes:
        plane.update(bytes([128]) * plane.buffer_size)
    packets = [*encoder.encode(frame), *encoder.encode(None)]
    data = b''.join(bytes(packet) for packet in packets)
    nals = [nal for nal in re.split(b'\x00\x00\x00\x01|\x00\x00\x01', data) if nal]
    parameters = {(nal[0] >> 1) & 63: nal for nal in nals}
    description = hevc_decoder_configuration_record(parameters[32], parameters[33], parameters[34])
    return description, nals


class FakePlane:
    def __init__(self, data: bytes, line_size: int):
        self._data = data
        self.line_size = line_size

    def __bytes__(self):
        return self._data


class YuvPackingTests(unittest.TestCase):
    def test_pack_yuv_frame_binary_layout(self):
        width, height = 4, 2
        timestamp_us = 1234567890123
        y = bytes(range(1, 9))
        u = bytes([201, 202])
        v = bytes([211, 212])

        packed = pack_yuv_frame(width, height, timestamp_us, y, u, v)

        self.assertEqual(len(packed), 12 + width * height * 3 // 2)
        parsed_w, parsed_h, parsed_ts = struct.unpack_from('>HHQ', packed, 0)
        self.assertEqual((parsed_w, parsed_h, parsed_ts), (width, height, timestamp_us))
        self.assertEqual(packed[12:20], y)
        self.assertEqual(packed[20:22], u)
        self.assertEqual(packed[22:24], v)

    def test_extract_i420_planes_tight_rows(self):
        y_rows = b'ABCD' + b'EFGH'
        u_rows = b'12'
        v_rows = b'34'
        frame = SimpleNamespace(
            width=4,
            height=2,
            planes=(
                FakePlane(y_rows, line_size=4),
                FakePlane(u_rows, line_size=2),
                FakePlane(v_rows, line_size=2),
            ),
        )

        y, u, v = extract_i420_planes(frame)

        self.assertEqual(y, y_rows)
        self.assertEqual(u, u_rows)
        self.assertEqual(v, v_rows)

    def test_extract_i420_planes_strips_padded_stride(self):
        # 4x4 frame: Y is 4x4 (stride 8), U and V are 2x2 (stride 4)
        y_padded = (
            b'AAAA\x00\x00\x00\x00'
            b'BBBB\xff\xff\xff\xff'
            b'CCCC\xaa\xaa\xaa\xaa'
            b'DDDD\x55\x55\x55\x55'
        )
        u_padded = b'12\xde\xad' + b'34\xbe\xef'
        v_padded = b'56\xca\xfe' + b'78\xba\xbe'
        frame = SimpleNamespace(
            width=4,
            height=4,
            planes=(
                FakePlane(y_padded, line_size=8),
                FakePlane(u_padded, line_size=4),
                FakePlane(v_padded, line_size=4),
            ),
        )

        y, u, v = extract_i420_planes(frame)

        self.assertEqual(y, b'AAAABBBBCCCCDDDD')
        self.assertEqual(u, b'1234')
        self.assertEqual(v, b'5678')


class SoftwareYuvDecoderTests(unittest.TestCase):
    def test_decodes_synthetic_hevc_to_tight_i420_without_mjpeg_encoder(self):
        description, nals = hevc_fixture(1280, 2560)
        packet = b''.join(struct.pack('>I', len(nal)) + nal for nal in nals)

        for quality, expected in [('economy', (480, 960)), ('balanced', (784, 1568)), ('detail', (1080, 2160))]:
            with self.subTest(quality=quality):
                decoder = SoftwareYuvDecoder(description, quality)
                self.assertFalse(hasattr(decoder, 'encoder'))
                self.assertEqual(decoder.decoder.name, 'hevc')
                payload = decoder.decode(packet)
                self.assertIsNotNone(payload)
                w, h, ts_us = struct.unpack_from('>HHQ', payload, 0)
                self.assertEqual((w, h), expected)
                self.assertGreater(ts_us, 0)
                self.assertEqual(len(payload), 12 + w * h * 3 // 2)

    def test_decoder_throttles_output_to_profile_fps(self):
        description, nals = hevc_fixture()
        packet = b''.join(struct.pack('>I', len(nal)) + nal for nal in nals)
        decoder = SoftwareYuvDecoder(description, 'economy')
        with patch('mirros.video.time.monotonic', side_effect=[100.0, 100.0, 100.01, 100.06, 100.06]):
            first = decoder.decode(packet)
            second = decoder.decode(packet)
            third = decoder.decode(packet)

        self.assertIsNotNone(first)
        self.assertIsNone(second)
        self.assertIsNotNone(third)
        _, _, first_ts = struct.unpack_from('>HHQ', first, 0)
        _, _, third_ts = struct.unpack_from('>HHQ', third, 0)
        self.assertEqual(first_ts, 100_000_000)
        self.assertEqual(third_ts, 100_060_000)


class SoftwareYuvStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_orientation_connection_routes_frames_yuv_and_rejects_invalid_quality(self):
        from mirros.adapter_http import orientation_connection

        for path, expected_quality in [
            ('/frames.yuv', 'balanced'),
            ('/frames.yuv?quality=economy', 'economy'),
            ('/frames.yuv?quality=balanced', 'balanced'),
            ('/frames.yuv?quality=detail', 'detail'),
            ('/frames.yuv?quality=invalid', None),
        ]:
            with self.subTest(path=path):
                reader = asyncio.StreamReader()
                reader.feed_data(f'GET {path} HTTP/1.1\r\nHost: localhost\r\n\r\n'.encode())
                reader.feed_eof()
                writer = SimpleNamespace(write=Mock(), drain=AsyncMock(), close=Mock())
                server = SimpleNamespace(_refuse_request=Mock(return_value=None))
                with patch('mirros.video.software_yuv_stream', new_callable=AsyncMock) as stream:
                    await orientation_connection(server, reader, writer, AsyncMock())
                    if expected_quality is None:
                        stream.assert_not_awaited()
                        self.assertIn(b'400 Bad Request', writer.write.call_args.args[0])
                        writer.close.assert_called_once()
                    else:
                        stream.assert_awaited_once_with(server, writer, expected_quality)

    async def test_http_yuv_stream_emits_framed_i420_and_unregisters_on_disconnect(self):
        _, nals = hevc_fixture()
        parameters = {(nal[0] >> 1) & 63: nal for nal in nals}
        payload = b''.join(struct.pack('>I', len(nal)) + nal for nal in nals)
        message = struct.pack('>I', len(payload) + 1) + b'\x00' + payload
        server = SimpleNamespace(
            _ensure_fresh_stream=AsyncMock(),
            _init_sequence=message,
            _vps_nal=parameters[32],
            _sps_nal=parameters[33],
            _pps_nal=parameters[34],
            _subscribers={},
            _pli_tasks=set(),
            _request_recovery_idr=Mock(),
        )
        writes = []

        async def drain():
            if len(writes) > 1:
                raise ConnectionResetError('viewer disconnected')

        writer = SimpleNamespace(write=writes.append, drain=drain, close=Mock())
        await asyncio.wait_for(software_yuv_stream(server, writer, 'balanced'), 3)

        self.assertIn(b'200 OK', writes[0])
        self.assertIn(b'Content-Type: application/octet-stream', writes[0])
        _, packet, _ = writes[1].split(b'\r\n', 2)
        size = struct.unpack_from('>I', packet, 0)[0]
        self.assertEqual(size, len(packet) - 4)
        w, h, ts_us = struct.unpack_from('>HHQ', packet, 4)
        self.assertEqual((w, h), (320, 640))
        self.assertGreater(ts_us, 0)
        self.assertEqual(size, 12 + w * h * 3 // 2)
        self.assertEqual(server._subscribers, {})
        writer.close.assert_called_once()


class DesktopProxyAllowlistTests(unittest.TestCase):
    def test_desktop_main_allows_frames_yuv_route(self):
        main_cjs = Path(__file__).resolve().parents[1] / 'desktop' / 'main.cjs'
        source = main_cjs.read_text(encoding='utf-8')
        match = re.search(r'const\s+routes\s*=\s*new\s+Set\(\[(.*?)\]\)', source, re.DOTALL)
        self.assertIsNotNone(match)
        self.assertIn("'/frames.yuv'", match.group(1))
