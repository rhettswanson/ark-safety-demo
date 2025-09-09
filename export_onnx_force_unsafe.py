# export_onnx_force_unsafe.py
# One-off ONNX export that disables the safe loader for this process only.

import torch
from ultralytics import YOLO

# Monkey-patch torch.load so it doesn't use weights_only
_orig_load = torch.load
def _unsafe_load(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _orig_load(*args, **kwargs)
torch.load = _unsafe_load  # unsafe, but only for this process

# Load and export
m = YOLO("yolov8n.pt")              # must be in this folder
out = m.export(
    format="onnx",
    simplify=True,
    opset=12,
    dynamic=False
)
print("✅ ONNX written to:", out)