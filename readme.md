# 100% Vibecoded webgl2 graphics debugger
hosted at: https://erichederstedt.github.io/WebGraphicsDebugger/wgd.bundle.js

inject via:
```js
var newScript = document.createElement("script");
newScript.onload = function() {
  window.wgd = new WGD.Debugger();
  window.wgd.displayUI();
};
document.head.appendChild(newScript);
newScript.src = "https://erichederstedt.github.io/WebGraphicsDebugger/wgd.bundle.js";
```