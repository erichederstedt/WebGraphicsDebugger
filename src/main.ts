import { layoutSetColumns, uiBox, uiImage, uiInit, uiPanelBegin, uiPanelEnd, uiStyle, uiText, uiUpdate } from "./ui.js";
import { getKeyInputState, getMouseInputState, getTextHeight, getTextWidth, processCommands } from "./ui_backend_canvas.js";

async function loadImageBitmap(url: string): Promise<ImageBitmap> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    return await createImageBitmap(blob);
}
const bitmap = await loadImageBitmap("image.png");

var prevTime: DOMHighResTimeStamp = 0.0;
function draw(time: DOMHighResTimeStamp) {
    const dt = time - prevTime;

    const enableOldSystem = false;
    if (enableOldSystem) {
        uiStyle(1.0, 0.0, 0.0);
        if (uiPanelBegin(25, 0, 200, 200)) {
            layoutSetColumns(2);
            uiStyle(0.0, 1.0, 0.0);
            uiBox(64, 64);
            uiImage(64, 64, bitmap);
            layoutSetColumns(3);
            uiStyle(0.0, 0.0, 1.0);
            uiBox(64, 64);
            uiImage(64, 64, bitmap);
            uiText("Hello, world!");
            uiStyle(0.0, 1.0, 0.0);
            uiBox(64, 64);
        }
        uiPanelEnd();
    }

    // ctx.fillStyle = "skyblue";
    // ctx.fillRect(0, 0, 100, 300);

    uiUpdate(processCommands, getKeyInputState, getMouseInputState);
    requestAnimationFrame(draw);
    prevTime = time;
}

function main() {
    uiInit(getTextWidth, getTextHeight);
    console.log("fuck");

    draw(0.0);
}

main();