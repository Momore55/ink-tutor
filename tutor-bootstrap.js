import {BoardScene} from './board-scene.js?v=user-1';
import {PlaybackSynchronizer} from './playback-sync.js?v=user-1';

globalThis.InkUserBoardScene=BoardScene;
globalThis.InkUserPlaybackSynchronizer=PlaybackSynchronizer;
await import('./board-bridge.js?v=user-1');
await import('./playback-bridge.js?v=user-1');
// Keep the existing app's classic-script scope and its diagnostics entry points.
const script=document.createElement('script');script.src='app.js?v=user-1';
script.onerror=()=>{document.getElementById('caption').textContent='Ink Tutor could not load. Refresh the page.';};
document.body.append(script);
