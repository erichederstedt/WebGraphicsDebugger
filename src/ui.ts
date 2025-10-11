/**
 * ui.ts - UI module
 */

type QuadCommand = {
    type: "quad";
    x: number;
    y: number;
    width: number;
    height: number;
}
type StyleCommand = {
    type: "style";
    r: number;
    g: number;
    b: number;
}
type TextCommand = {
    type: "text";
    x: number;
    y: number;
    text: string;
}
export type Command = QuadCommand | StyleCommand | TextCommand;
export const drawCommands: Array<Command> = [];

export function uiPanel(x: number, y: number, width: number, height: number) {
    drawCommands.push({
        type: "style",
        r: 1.0,
        g: 1.0,
        b: 1.0,
    });
    drawCommands.push({
        type: "quad",
        x: x,
        y: y,
        width: width,
        height: height,
    });
}

var keyInputState: Array<boolean> = new Array(256).fill(false);
var keyPrevInputState: Array<boolean> = new Array(256).fill(false);

export function isKeyDown(keyCode: number): boolean {
    return keyInputState[keyCode];
}
export function isKeyPressed(keyCode: number): boolean {
    return keyInputState[keyCode] && !keyPrevInputState[keyCode];
}
export function isKeyReleased(keyCode: number): boolean {
    return !keyInputState[keyCode] && keyPrevInputState[keyCode];
}

function advanceInputState(newInputState: Array<boolean>) {
    if (newInputState.length !== 256)
        throw new Error("newInputState must be of length 256");

    for (let i = 0; i < keyInputState.length; i++) {
        keyPrevInputState[i] = keyInputState[i];
    }
    for (let i = 0; i < keyInputState.length; i++) {
        keyInputState[i] = newInputState[i];
    }
}

// Implement basic mouse input state tracking like keyboard
export type MouseState = { x: number, y: number, wheelDelta: number, buttons: [boolean, boolean, boolean, boolean, boolean] };
var mouseInputState: MouseState = { x: 0.0, y: 0.0, wheelDelta: 0.0, buttons: [false, false, false, false, false] };
var mousePrevInputState: MouseState = { x: 0.0, y: 0.0, wheelDelta: 0.0, buttons: [false, false, false, false, false] };
export function getMouseState() {
    return mouseInputState;
}
export function isMouseButtonDown(button: number): boolean {
    return mouseInputState.buttons[button];
}
export function isMouseButtonPressed(button: number): boolean {
    return mouseInputState.buttons[button] && !mousePrevInputState.buttons[button];
}
export function isMouseButtonReleased(button: number): boolean {
    return !mouseInputState.buttons[button] && mousePrevInputState.buttons[button];
}
function advanceMouseInputState(newInputState: MouseState) {
    mousePrevInputState.x = mouseInputState.x;
    mousePrevInputState.y = mouseInputState.y;
    mousePrevInputState.wheelDelta = mouseInputState.wheelDelta;
    for (let i = 0; i < mouseInputState.buttons.length; i++) {
        mousePrevInputState.buttons[i] = mouseInputState.buttons[i];
    }
    mouseInputState.x = newInputState.x;
    mouseInputState.y = newInputState.y;
    mouseInputState.wheelDelta = newInputState.wheelDelta;
    for (let i = 0; i < mouseInputState.buttons.length; i++) {
        mouseInputState.buttons[i] = newInputState.buttons[i];
    }
}

/**
 * 
 * @param processor Function that processes the draw commands
 * @param keyInputHandler Function that updates the input state(has to be of length 256)
 */
export function update(processor: (commands: ReadonlyArray<Command>) => void, keyInputHandler: () => Array<boolean>, mouseInputHandler: () => MouseState) {
    advanceInputState(keyInputHandler());
    advanceMouseInputState(mouseInputHandler());
    processor(drawCommands);
    drawCommands.length = 0;
}