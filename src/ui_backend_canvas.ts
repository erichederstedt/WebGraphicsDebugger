/**
 * ui_backend_canvas.ts - Canvas backend for the UI module
*/
import { Command, MouseState } from "./ui.js";

const canvas: HTMLCanvasElement = document.getElementById("surface") as HTMLCanvasElement;
const ctx: CanvasRenderingContext2D = canvas.getContext("2d");

export function processCommands(drawCommands: ReadonlyArray<Command>) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var texture: CanvasImageSource = null;
    for (let i = 0; i < drawCommands.length; i++) {
        const command = drawCommands[i];

        switch (command.type) {
            case "style":
                ctx.fillStyle = `rgba(${command.r * 255}, ${command.g * 255}, ${command.b * 255}, 1)`;
                break;

            case "quad":
                if (texture)
                    ctx.drawImage(texture, command.x, command.y, command.width, command.height);
                else
                    ctx.fillRect(command.x, command.y, command.width, command.height);
                break;

            case "text":
                ctx.fillText(command.text, command.x, command.y);
                break;

            case "texture":
                texture = command.texture;
                break;
        }
    }
}

export function getTextWidth(text: string): number {
    return ctx.measureText(text).width;
}
export function getTextHeight(text: string): number {
    const metrics = ctx.measureText(text);
    return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
}

var keyInputState: Array<boolean> = new Array(256).fill(false);
window.addEventListener("keydown", (e) => {
    if (e.key.length === 1) {
        const keyCode = e.key.toUpperCase().charCodeAt(0);
        if (keyCode < 256) {
            keyInputState[keyCode] = true;
        }
    }
});
window.addEventListener("keyup", (e) => {
    if (e.key.length === 1) {
        const keyCode = e.key.toUpperCase().charCodeAt(0);
        if (keyCode < 256) {
            keyInputState[keyCode] = false;
        }
    }
});
export function getKeyInputState(): Array<boolean> {
    return keyInputState;
}

var hasUpdatedWheelDeltaThisFrame: boolean = false;
var mouseInputState: MouseState = { x: 0.0, y: 0.0, wheelDelta: 0.0, buttons: [false, false, false, false, false] };
window.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseInputState.x = e.clientX - rect.left;
    mouseInputState.y = e.clientY - rect.top;
});
window.addEventListener("wheel", (e) => {
    mouseInputState.wheelDelta = e.deltaY;
    hasUpdatedWheelDeltaThisFrame = true;
});
window.addEventListener("mousedown", (e) => {
    if (e.button >= 0 && e.button < 5) {
        mouseInputState.buttons[e.button] = true;
    }
});
window.addEventListener("mouseup", (e) => {
    if (e.button >= 0 && e.button < 5) {
        mouseInputState.buttons[e.button] = false;
    }
});
export function getMouseInputState(): MouseState {
    if (!hasUpdatedWheelDeltaThisFrame) {
        mouseInputState.wheelDelta = 0.0;
    }
    hasUpdatedWheelDeltaThisFrame = false;
    return mouseInputState;
}

function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;

    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;

    ctx.scale(ratio, ratio);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();