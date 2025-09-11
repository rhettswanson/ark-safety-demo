// three-shim.js
export * from "https://unpkg.com/three@0.176.0/build/three.module.js?module&orig=1";
export function hasOwnProperty(prop) {
  return Object.prototype.hasOwnProperty.call(this, prop);
}