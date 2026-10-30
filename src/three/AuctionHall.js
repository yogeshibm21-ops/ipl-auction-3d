import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FRANCHISES } from "../data/franchises.js";

const material = (color, roughness = 0.72) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.16 });

export class AuctionHall {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#090d19");
    this.scene.fog = new THREE.Fog("#090d19", 30, 90);
    this.camera = new THREE.PerspectiveCamera(43, 1, 0.1, 120);
    this.camera.position.set(0, 12, 31);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 3, 0);
    this.controls.addEventListener("start", () => { this.cameraTransition = null; });
    this.controls.minDistance = 8;
    this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.clock = new THREE.Clock();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.attachTo(canvas.parentElement);
    this.createVenue();
    this.resize();
    this.animate();
    this.presets = {
      wide: [0, 12, 31, 0, 3, 0],
      stage: [0, 7, 14, 0, 3, 0],
      auctioneer: [3, 5, 8, 0, 3.6, 0],
      player: [-6, 6, 10, 0, 2.5, 0],
      table: [0, 4, 8, -4, 1.4, 0],
      leader: [8, 4, 9, 4, 1.4, 0]
    };
    this.animateTo("wide");
  }

  attachTo(container) {
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(container);
    this.resize();
  }

  addMesh(geometry, mat, position, parent = this.scene) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  createVenue() {
    this.scene.add(new THREE.HemisphereLight(0x9fb6df, 0x10121d, 2.2));
    const key = new THREE.DirectionalLight(0xffe3ae, 3.1);
    key.position.set(4, 15, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.PointLight(0x4796ff, 48, 45);
    fill.position.set(-12, 9, -6);
    this.scene.add(fill);
    const floor = this.addMesh(new THREE.PlaneGeometry(75, 75), material("#171b29"), [0, -0.08, 0]);
    floor.rotation.x = -Math.PI / 2;
    const stage = this.addMesh(new THREE.CylinderGeometry(7.6, 8, 0.65, 48), material("#25334a"), [0, 0.26, -2]);
    stage.receiveShadow = true;
    this.addMesh(new THREE.CylinderGeometry(6.3, 7.7, 0.14, 48), material("#d6a943"), [0, 0.66, -2]);
    const backdrop = this.addMesh(new THREE.BoxGeometry(15, 7, 0.65), material("#101b31"), [0, 4.4, -8.6]);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(11.5, 3.1), new THREE.MeshBasicMaterial({ color: "#16284a" }));
    display.position.set(0, 4.4, -8.24);
    this.scene.add(display);
    const ledTrim = material("#d6a943", 0.38);
    this.addMesh(new THREE.BoxGeometry(12.1, 0.12, 0.14), ledTrim, [0, 6.03, -8.2]);
    this.addMesh(new THREE.BoxGeometry(12.1, 0.12, 0.14), ledTrim, [0, 2.77, -8.2]);
    const title = this.makeText("IPL AUCTION", "#d5ad57", 2.6);
    title.position.set(-3.4, 4.2, -8.18);
    this.scene.add(title);
    this.addMesh(new THREE.BoxGeometry(2.2, 1.25, 0.9), material("#4e5c70"), [0, 1.55, -3.3]);
    this.addMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 10), material("#d5d9df"), [0.45, 2.53, -3.5]);
    this.addAuctioneer();
    this.addTables();
    this.addAudience();
    this.addLights();
    for (let x = -23; x <= 23; x += 11.5) {
      this.addMesh(new THREE.BoxGeometry(0.7, 9, 0.7), material("#263146"), [x, 4.45, -12]);
      this.addMesh(new THREE.BoxGeometry(6, 0.5, 0.6), material("#34445f"), [x, 8.7, -12]);
    }
  }

  makeText(text, color, size = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    context.font = "700 64px Arial";
    context.fillStyle = color;
    context.textAlign = "center";
    context.fillText(text, 256, 82);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.scale.set(size * 2.5, size * 0.65, 1);
    return sprite;
  }

  addAuctioneer() {
    this.character = new THREE.Group();
    this.character.position.set(0, 0.8, -2.3);
    const suit = material("#17243a");
    const shirt = material("#e8e5df");
    const skin = material("#c98e6b");
    const trousers = material("#101725");
    this.addMesh(new THREE.CapsuleGeometry(0.52, 1.15, 4, 8), suit, [0, 1.25, 0], this.character);
    this.addMesh(new THREE.CylinderGeometry(0.19, 0.21, 0.38, 16), skin, [0, 2.12, 0], this.character);
    const head = this.addMesh(new THREE.SphereGeometry(0.43, 20, 16), skin, [0, 2.57, 0], this.character);
    head.scale.set(0.82, 1.08, 0.83);
    this.addMesh(new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), material("#20212a"), [0, 2.83, -0.01], this.character);
    this.addMesh(new THREE.BoxGeometry(0.44, 0.1, 0.4), shirt, [0, 1.96, 0.22], this.character);
    this.addMesh(new THREE.ConeGeometry(0.11, 0.46, 4), material("#b92d45"), [0, 1.63, 0.34], this.character);
    this.auctioneerArms = [];
    for (const side of [-1, 1]) {
      const arm = this.addMesh(new THREE.CapsuleGeometry(0.16, 0.73, 4, 8), suit, [side * 0.63, 1.43, 0.02], this.character);
      arm.rotation.z = side * -0.25;
      this.auctioneerArms.push(arm);
      this.addMesh(new THREE.SphereGeometry(0.17, 12, 10), skin, [side * 0.72, 0.92, 0.06], this.character);
      this.addMesh(new THREE.CylinderGeometry(0.21, 0.18, 0.9, 12), trousers, [side * 0.23, 0.15, 0], this.character);
    }
    this.scene.add(this.character);
  }

  addTables() {
    this.teamObjects = new Map();
    const torsoGeometry = new THREE.CapsuleGeometry(0.27, 0.55, 3, 7);
    const headGeometry = new THREE.SphereGeometry(0.22, 10, 8);
    const armGeometry = new THREE.CapsuleGeometry(0.075, 0.42, 3, 6);
    const torsoMaterial = material("#26364f");
    const skinMaterial = material("#b9866a");
    const sleeveMaterial = material("#e2e5eb");
    FRANCHISES.forEach((team, index) => {
      const angle = (index / FRANCHISES.length) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(angle) * 12.5;
      const z = Math.sin(angle) * 10.5 + 1.2;
      const group = new THREE.Group();
      group.position.set(x, 0, z);
      group.rotation.y = Math.atan2(-x, -z);
      const accent = material(team.colors[0]);
      this.addMesh(new THREE.BoxGeometry(3.1, 0.25, 1.65), material("#232b3a"), [0, 1.15, 0], group);
      this.addMesh(new THREE.BoxGeometry(3.1, 0.14, 1.65), accent, [0, 1.31, 0], group);
      this.addMesh(new THREE.BoxGeometry(2.4, 0.55, 0.12), material("#131b2b"), [0, 1.76, -0.48], group);
      const label = this.makeText(team.code, "#ffffff", 0.9);
      label.position.set(0, 1.76, -0.39);
      group.add(label);
      const representative = new THREE.Group();
      representative.position.set(0, 1.38, 0.62);
      this.addMesh(torsoGeometry, torsoMaterial, [0, 0.35, 0], representative);
      this.addMesh(headGeometry, skinMaterial, [0, 0.88, 0], representative);
      const biddingArm = this.addMesh(armGeometry, sleeveMaterial, [0.38, 0.55, 0], representative);
      biddingArm.rotation.z = 0.12;
      group.add(representative);
      group.userData.representative = representative;
      group.userData.biddingArm = biddingArm;
      for (const side of [-1, 1]) {
        this.addMesh(new THREE.BoxGeometry(0.7, 0.16, 0.6), material("#151a27"), [side * 1.65, 0.92, -0.35], group);
        this.addMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), material("#586477"), [side * 1.65, 0.45, -0.35], group);
      }
      const indicator = new THREE.PointLight(team.colors[0], 0, 5);
      indicator.position.set(0, 2.5, 0);
      group.add(indicator);
      group.userData.indicator = indicator;
      this.teamObjects.set(team.code, group);
      this.scene.add(group);
    });
  }

  addAudience() {
    const geometry = new THREE.CylinderGeometry(0.13, 0.15, 0.62, 6);
    const colors = ["#27344b", "#39435a", "#55415b", "#314d5b"];
    const materialArray = colors.map((color) => material(color));
    for (let row = 0; row < 4; row += 1) {
      const instanced = new THREE.InstancedMesh(geometry, materialArray[row % materialArray.length], 90);
      const matrix = new THREE.Matrix4();
      let count = 0;
      for (let i = 0; i < 90; i += 1) {
        const angle = (i / 90) * Math.PI * 2;
        const radius = 20 + row * 2.2;
        matrix.makeTranslation(Math.cos(angle) * radius, 1 + row * 0.48, Math.sin(angle) * radius);
        instanced.setMatrixAt(count++, matrix);
      }
      instanced.count = count;
      this.scene.add(instanced);
    }
  }

  addLights() {
    for (let i = 0; i < 8; i += 1) {
      const x = -14 + i * 4;
      const light = new THREE.SpotLight(i % 2 ? 0x74aaff : 0xffd681, 80, 45, 0.5, 0.7);
      light.position.set(x, 13, -4);
      light.target.position.set(0, 0, -1);
      this.scene.add(light, light.target);
    }
  }

  setLeader(code) {
    this.activeLeader = code;
    for (const [teamCode, group] of this.teamObjects) {
      group.userData.indicator.intensity = teamCode === code ? 14 : 0;
      group.userData.representative.userData.isBidding = teamCode === code;
    }
  }

  setSpeaking(active) {
    if (this.character) this.character.userData.speaking = active;
  }

  animateTo(name) {
    const preset = this.presets?.[name];
    if (!preset) return;
    this.cameraTransition = {
      fromPosition: this.camera.position.clone(),
      toPosition: new THREE.Vector3(...preset.slice(0, 3)),
      fromTarget: this.controls.target.clone(),
      toTarget: new THREE.Vector3(...preset.slice(3)),
      startedAt: performance.now(),
      duration: 720
    };
  }

  resize() {
    const width = this.canvas.parentElement.clientWidth || 1;
    const height = this.canvas.parentElement.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = this.clock.getElapsedTime();
    const transition = this.cameraTransition;
    if (transition) {
      const progress = Math.min(1, (performance.now() - transition.startedAt) / transition.duration);
      const eased = progress * progress * (3 - 2 * progress);
      this.camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
      this.controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
      if (progress === 1) this.cameraTransition = null;
    }
    if (this.character) {
      this.character.rotation.y = Math.sin(elapsed * 0.7) * 0.035;
      this.character.position.y = 0.8 + Math.sin(elapsed * 1.4) * 0.025;
      this.auctioneerArms?.forEach((arm, index) => {
        const side = index === 0 ? -1 : 1;
        arm.rotation.z = side * (-0.25 + (this.character.userData.speaking ? Math.sin(elapsed * 8 + index) * 0.17 : 0));
      });
    }
    for (const group of this.teamObjects?.values() ?? []) {
      const representative = group.userData.representative;
      const arm = group.userData.biddingArm;
      const bidding = representative.userData.isBidding;
      const gesture = bidding ? -0.95 + Math.sin(elapsed * 10) * 0.12 : 0.12;
      arm.rotation.z += (gesture - arm.rotation.z) * 0.14;
      representative.position.y = 1.38 + (bidding ? Math.sin(elapsed * 8) * 0.04 : 0);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((item) => item.dispose());
      }
    });
  }
}
