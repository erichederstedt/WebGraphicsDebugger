/**
 * ui.ts - UI module
 */

type Texture = any;

export type QuadCommand = {
    type: "quad";
    x: number;
    y: number;
    width: number;
    height: number;
}
export type StyleCommand = {
    type: "style";
    r: number;
    g: number;
    b: number;
}
export type TextCommand = {
    type: "text";
    x: number;
    y: number;
    text: string;
}
export type TextureCommand = {
    type: "texture";
    texture: Texture;
}
export type Command = QuadCommand | StyleCommand | TextCommand | TextureCommand;
export const drawCommands: Array<Command> = [];

enum LayoutOrgin {
    TopLeft,
    TopRight,
    Center,
    BottomLeft,
    BottomRight,
}
type Layout = {
    x: number;
    y: number;
    width: number;
    height: number;
    cursorHeight: number;
    columns: number;
    columnCount: number;
    cursorWidth: number;
    largestHeight: number;
    // origin: LayoutOrgin;
}
const layoutStack: Array<Layout> = [];
function layoutPush(x: number, y: number, width: number, height: number, relative: boolean = true): Layout {
    const layout: Layout = layoutGet();
    if (layout) {
        x += layout.x;
        y += layout.y;

        y += layout.cursorHeight;
        x += layout.cursorWidth;

        if (height > layout.largestHeight) {
            layout.largestHeight = height;
        }

        if ((layout.columnCount + 1) >= layout.columns) {
            layout.cursorHeight += layout.largestHeight;
            layout.cursorWidth = 0;
            layout.columnCount = 0;
        }
        else {
            layout.cursorWidth += width;
            layout.columnCount += 1;
        }
    }
    layoutStack.push({
        x: x,
        y: y,
        width: width,
        height: height,
        cursorHeight: 0,
        columns: 1,
        columnCount: 0,
        cursorWidth: 0,
        largestHeight: 0,
    });

    // TODO: Handle marking of parent layout as needing a scroll bar if current layout exceeds size of parent layout.

    return layoutGet();
}
function layoutPop(): Layout {
    return layoutStack.pop();
}
function layoutGet(): Layout {
    if (layoutStack.length < 1)
        return null;
    return layoutStack[layoutStack.length - 1];
}
export function layoutSetColumns(columns: number) {
    layoutGet().columns = columns;
}

export function uiPanelBegin(x: number, y: number, width: number, height: number): boolean {
    const layout = layoutPush(x, y, width, height);
    drawCommands.push({
        type: "quad",
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
    });

    return true;
}
export function uiPanelEnd() {
    layoutPop();
    // TODO: Handle drawing and logic of scroll bars if layout has is marked for it.
}
export function uiBox(width: number, height: number) {
    const layout = layoutPush(0, 0, width, height);
    drawCommands.push({
        type: "quad",
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
    });
    layoutPop();
}
export function uiImage(width: number, height: number, image: Texture) {
    drawCommands.push({
        type: "texture",
        texture: image
    });

    uiBox(width, height);

    drawCommands.push({
        type: "texture",
        texture: null
    });
}
export function uiText(text: string) {
    const width = getTextWidth(text);
    const height = getTextHeight(text);
    const layout = layoutPush(0, height, width, height);
    drawCommands.push({
        type: "text",
        x: layout.x,
        y: layout.y,
        text: text,
    });
    layoutPop();
}
export function uiStyle(r: number, g: number, b: number) {
    drawCommands.push({
        type: "style",
        r: r,
        g: g,
        b: b,
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

var _getTextWidth: (text: string) => number = null;
function getTextWidth(text: string): number {
    return _getTextWidth ? _getTextWidth(text) : 0;
}
var _getTextHeight: (text: string) => number = null;
function getTextHeight(text: string): number {
    return _getTextHeight ? _getTextHeight(text) : 0;
}

export function uiInit(getTextWidthImpl: (text: string) => number, getTextHeightImpl: (text: string) => number) {
    _getTextWidth = getTextWidthImpl;
    _getTextHeight = getTextHeightImpl;
}

/**
 * 
 * @param processor Function that processes the draw commands
 * @param keyInputHandler Function that updates the input state(has to be of length 256)
 */
export function uiUpdate(processor: (commands: ReadonlyArray<Command>) => void, keyInputHandler: () => Array<boolean>, mouseInputHandler: () => MouseState) {
    advanceInputState(keyInputHandler());
    advanceMouseInputState(mouseInputHandler());
    processor(drawCommands);
    drawCommands.length = 0;
}