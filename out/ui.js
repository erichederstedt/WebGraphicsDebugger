"use strict";
/**
 * ui.ts - UI module
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.drawCommands = void 0;
exports.uiPanel = uiPanel;
exports.update = update;
exports.drawCommands = [];
function uiPanel(x, y, width, height) {
    exports.drawCommands.push({
        type: "style",
        r: 1.0,
        g: 1.0,
        b: 1.0,
    });
    exports.drawCommands.push({
        type: "quad",
        x: x,
        y: y,
        width: width,
        height: height,
    });
}
function update(processor) {
    processor(exports.drawCommands);
    exports.drawCommands.length = 0;
}
//# sourceMappingURL=ui.js.map