# export_onnx_allowlist.py
# Lets PyTorch unpickle the classes referenced inside the Ultralytics checkpoint.

from torch.serialization import add_safe_globals
from torch.nn.modules.container import Sequential
from ultralytics.nn.tasks import DetectionModel
from ultralytics import YOLO
from ultralytics.nn.modules.conv import Conv
add_safe_globals([DetectionModel, Sequential, Conv])

# Allow the globals referenced by the checkpoint (adjust list if PyTorch asks for more)
add_safe_globals([DetectionModel, Sequential])

# Load and export
m = YOLO("yolov8n.pt")  # must exist in this folder
m.export(format="onnx", simplify=True, opset=12, dynamic=False)

print("✅ Export finished: yolov8n.onnx")