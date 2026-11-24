import React from 'react';
import {ResizeHandles} from './Controls.jsx';

export function FloatingShell({audioStatus, preview, bridge, notice, t}) {
  return (
    <div className="floating-app" data-audio-status={audioStatus}>
      {preview}
      {bridge && <ResizeHandles t={t}/>}
      {notice && <div className="floating-notice" role="status">{notice}</div>}
    </div>
  );
}
