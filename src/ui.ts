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

export function update(processor: (commands: ReadonlyArray<Command>) => void) {
    processor(drawCommands);
    drawCommands.length = 0;
}