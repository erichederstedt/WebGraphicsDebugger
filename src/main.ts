import { uiPanel, update } from "./ui";
import { processCommands } from "./ui_backend_canvas";

var prevTime: DOMHighResTimeStamp = 0.0;
function draw(time: DOMHighResTimeStamp) {
    const dt = time - prevTime;

    uiPanel(0, 0, 100, 300);

    // ctx.fillStyle = "skyblue";
    // ctx.fillRect(0, 0, 100, 300);

    update(processCommands);
    requestAnimationFrame(draw);
    prevTime = time;
}

function main() {
    console.log("fuck");

    draw(0.0);
}

main();