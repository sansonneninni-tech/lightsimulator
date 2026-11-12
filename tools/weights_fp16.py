# Dimezza il peso del modello di profondità: pesi salvati in fp16, calcolo in fp32.
# uso: python3 tools/weights_fp16.py depth_fp32.onnx public/models/depth.onnx
import sys, numpy as np, onnx
from onnx import inliner, numpy_helper, helper, TensorProto
m = inliner.inline_local_functions(onnx.load(sys.argv[1]))
g = m.graph
inits, casts = [], []
for t in g.initializer:
    if t.data_type == TensorProto.FLOAT and np.prod(t.dims) >= 1024:
        inits.append(numpy_helper.from_array(numpy_helper.to_array(t).astype(np.float16), t.name + '_f16'))
        casts.append(helper.make_node('Cast', [t.name + '_f16'], [t.name], to=TensorProto.FLOAT))
    else:
        inits.append(t)
del g.initializer[:]; g.initializer.extend(inits)
nodes = list(g.node); del g.node[:]; g.node.extend(casts + nodes)
onnx.save(m, sys.argv[2])
