"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCommands = processCommands;
const canvas = document.getElementById("surface");
const ctx = canvas.getContext("2d");
function processCommands(drawCommands) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < drawCommands.length; i++) {
        const command = drawCommands[i];
        switch (command.type) {
            case "style":
                ctx.fillStyle = `rgba(${command.r * 255}, ${command.g * 255}, ${command.b * 255}, 1)`;
                break;
            case "quad":
                ctx.fillRect(command.x, command.y, command.width, command.height);
                break;
            case "text":
                ctx.fillText(command.text, command.x, command.y);
                break;
        }
    }
}
//# sourceMappingURL=ui_backend_canvas.js.map