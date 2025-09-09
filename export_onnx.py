from ultralytics import YOLO

# must be in the same folder as this script
model = YOLO("yolov8n.pt")
model.export(format="onnx", simplify=True, opset=12, dynamic=False)

print("✅ Export finished: yolov8n.onnx created")

