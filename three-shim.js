// three-shim.js
export * from 'https://unpkg.com/three@0.176.0/build/three.module.js';

// Provide a method so the namespace has a callable `hasOwnProperty`
export function hasOwnProperty(prop) {
  // when called as t.hasOwnProperty(prop), `this` == namespace object
  return Object.prototype.hasOwnProperty.call(this, prop);
}