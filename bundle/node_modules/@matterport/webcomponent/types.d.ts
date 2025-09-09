export * from './built-bundle/sdk';

import type { MpSdk } from './built-bundle/sdk';

interface MatterportViewerEventMap extends HTMLElementEventMap {
  mpSdkConnected: CustomEvent<{ mpSdk: MpSdk }>;
  mpSdkPlaying: CustomEvent<{ mpSdk: MpSdk }>;
  mpViewerError: CustomEvent<{ error: Error }>;
}

declare global {
  interface MatterportViewer extends HTMLElement {
    /**
     * The model SID for the viewer to display. Prefer using `setAttribute('m', 'YOUR_SID')`
     * over setting this directly.
     */
    m: string;

    /**
     * The Matterport SDK. You need to set the `application-key` attribute to a working
     * SDK key before this will be populated.
     *
     * Note that this property may not be populated immediately - prefer the `playingPromise`
     * or `sdkPromise` properties to handle async SDK setup.
     */
    mpSdk: MpSdk;

    /**
     * The Matterport SDK. You need to set the `application-key` attribute to a working
     * SDK key before this will be populated.
     *
     * This promise is resolved when the SDK has connected and the app enters the [Playing state](https://matterport.github.io/showcase-sdk/docs/reference/current/enums/app.phase.html#playing).
     *
     * ```ts
     * // in JavaScript:
     * const mpViewer = document.querySelector('matterport-viewer')
     * // or in TypeScript:
     * const mpViewer = document.querySelector<MatterportViewer>('matterport-viewer')
     *
     * // then (JS or TS):
     * const mpSdk = await mpViewer?.playingPromise
     * ```
     */
    playingPromise: Promise<MpSdk>;

    /**
     * The Matterport SDK. You need to set the `application-key` attribute to a working
     * SDK key before this will be populated.
     *
     * This promise is resolved when the SDK has connected and the app enters the [Starting state](https://matterport.github.io/showcase-sdk/docs/reference/current/enums/app.phase.html#starting).
     *
     * ```ts
     * // in JavaScript:
     * const mpViewer = document.querySelector('matterport-viewer')
     * // or in TypeScript:
     * const mpViewer = document.querySelector<MatterportViewer>('matterport-viewer')
     *
     * // then (JS or TS):
     * const mpSdk = await mpViewer?.sdkPromise
     * ```
     */
    sdkPromise: Promise<MpSdk>;

    // Augment listener methods with our additional custom event types
    addEventListener<K extends keyof MatterportViewerEventMap>(type: K, listener: (this: HTMLElement, ev: MatterportViewerEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    removeEventListener<K extends keyof MatterportViewerEventMap>(type: K, listener: (this: HTMLElement, ev: MatterportViewerEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
  }
}
