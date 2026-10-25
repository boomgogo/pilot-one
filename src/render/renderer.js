import {
  Color, DirectionalLight, Group, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { ResolutionController, TIERS } from '../core/quality.js';
import { BILLBOARD_RES } from './billboards.js';

/**
 * Two passes share one world coordinate system:
 *  - bgScene: sky cubemap, stars, planets, rings (huge distances, near=1)
 *  - scene:   gameplay + nearby scenery (near=0.3), rendered after a depth clear
 * All gameplay objects are children of `railRoot`, whose world transform is the rail frame.
 */
export class Renderer {
  constructor(canvas, tierName) {
    this.canvas = canvas;
    this.tierName = tierName;
    this.tier = TIERS[tierName];
    this.gl = new WebGLRenderer({
      canvas,
      antialias: this.tier.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.autoClear = false;
    this.gl.info.autoReset = false; // two passes per frame: reset manually
    this.gl.setClearColor(0x05060f, 1);

    this.scene = new Scene();
    this.bgScene = new Scene();
    this.railRoot = new Group();
    this.railRoot.name = 'railRoot';
    this.scene.add(this.railRoot);

    this.camera = new PerspectiveCamera(68, 1, 0.3, 3200);
    this.railRoot.add(this.camera);
    this.bgCamera = new PerspectiveCamera(68, 1, 2, 160000);
    this.bgCamera.matrixAutoUpdate = false;
    this.bgCamera.matrixWorldAutoUpdate = false; // follows the gameplay camera (set in render)

    this.sunDir = new Vector3(0, 1, 0);
    this.sun = new DirectionalLight(0xfff1dc, 2.6);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0x8fb4ff, 0x3a2050, 0.9);
    this.scene.add(this.hemi);
    this.baseSun = 2.6;
    this.baseHemi = 0.9;
    this.hemiDay = new Color(0x8fb4ff);
    this.hemiNight = new Color(0x5a4aa8);

    this.res = new ResolutionController(tierName);
    this.vFov = 68;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** A location's light (data.light): sun and sky-fill colours and strengths. Defaults: the gas giant's. */
  setPalette(p = {}) {
    this.sun.color.set(p.sun ?? 0xfff1dc);
    this.baseSun = p.sunI ?? 2.6;
    this.baseHemi = p.hemiI ?? 0.9;
    this.hemiDay.set(p.hemiDay ?? 0x8fb4ff);
    this.hemiNight.set(p.hemiNight ?? 0x5a4aa8);
    this.hemi.groundColor.set(p.ground ?? 0x3a2050);
  }

  setSunDirection(v) {
    this.sunDir.copy(v).normalize();
    this.sun.position.copy(this.sunDir).multiplyScalar(1000);
  }

  /** light factor 0..1 (planet / ring shadow), flash 0..1 (lightning, explosions) */
  setLighting(factor, flash = 0) {
    this.sun.intensity = this.baseSun * factor + flash * 2.5;
    this.hemi.intensity = this.baseHemi * (0.85 + 0.25 * factor) + flash * 1.2;
    this.hemi.color.copy(this.hemiNight).lerp(this.hemiDay, factor);
  }

  resize() {
    const w = Math.max(1, innerWidth);
    const h = Math.max(1, innerHeight);
    this.gl.setPixelRatio(this.res.pixelRatio());
    this.gl.setSize(w, h, false);
    this.gl.getDrawingBufferSize(BILLBOARD_RES.value);
    const aspect = w / h;
    // Landscape: fixed vertical FOV. Portrait: keep ~74° horizontal so the corridor stays visible.
    let vFov = 66;
    if (aspect < 1.25) {
      const hFov = 74 * (Math.PI / 180);
      vFov = Math.min(100, (2 * Math.atan(Math.tan(hFov / 2) / aspect) * 180) / Math.PI);
    }
    this.vFov = vFov;
    for (const cam of [this.camera, this.bgCamera]) {
      cam.aspect = aspect;
      cam.fov = vFov;
      cam.updateProjectionMatrix();
    }
    this.width = w;
    this.height = h;
  }

  /** Feed rAF frame times; adjusts the render scale when needed. */
  sampleFrame(dtMs) {
    if (this.res.sample(dtMs)) this.resize();
  }

  render() {
    const gl = this.gl;
    gl.info.reset();
    this.scene.updateMatrixWorld();
    this.bgCamera.matrixWorld.copy(this.camera.matrixWorld);
    this.bgCamera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    gl.clear(true, true, false);
    gl.render(this.bgScene, this.bgCamera);
    gl.clearDepth();
    gl.render(this.scene, this.camera);
  }
}
