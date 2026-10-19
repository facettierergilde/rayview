import express from "express";
import fileUpload from "express-fileupload";
import { WebSocketServer } from "ws";


const app = express();
app.use(fileUpload());
const wss = new WebSocketServer({ port: 3001});

console.log("Websocket running on 3001");

app.post("/upload", (req, res) => {
    const modelFile = req.files.file;
    const name = req.body.name;
    const rotation = req.body.rot_euler;
    const rotX = req.body.rotX;
    const rotY = req.body.rotY;
    const rotZ = req.body.rotZ;
    const pos = req.body.pos;

    const outPath = `./sync/sync.stl`;
    console.log("upload received, name: %s, rotation: %s, rotX: %d, rotY: %d, rotZ: %d, pos: %s", name, rotation, rotX, rotY, rotZ, pos);
    modelFile.mv(outPath, err => {
        if(err) return res.status(500).send(err);
        
        //Notify clients of mesh update
        wss.clients.forEach(c => {
            if(c.readyState === 1) {
                c.send(JSON.stringify({ type: "mesh", name, url: `/${name}.stl`, rotX, rotY, rotZ, pos }));
            }
        });
        res.send("Mesh updated");
    });
});

app.listen(3000, () => console.log("HTTP on 3000"));