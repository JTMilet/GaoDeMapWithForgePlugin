three = THREE;

class GeoThreeExtension extends Autodesk.Viewing.Extension {
  load() {
    var DEV_BING_API_KEY =
      "AuViYD_FXGfc3dxc0pNa8ZEJxyZyPq1lwOLPCOydV3f0tlEVH-HKMgxZ9ilcRj-T";
    var provider = new Geo.BingMapsProvider(
      DEV_BING_API_KEY,
      Geo.BingMapsProvider.ROAD
    );

    var map = new Geo.MapView(Geo.MapView.PLANAR, provider);
    map.position.set(14900, -27300, -45);
    viewer.overlays.addScene("map");
    viewer.overlays.addMesh(map, "map");
    map.updateMatrixWorld(false);

    viewer.autocam.shotParams.destinationPercent = 3;
    viewer.autocam.shotParams.duration = 3;
    var cam = viewer.getCamera();

    viewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, () => {
      viewer.autocam.toPerspective();
      map.lod.updateLOD(
        map,
        cam,
        viewer.impl.glrenderer(),
        viewer.overlays.impl.overlayScenes.map.scene,
        viewer.impl
      );
    });
    return true;
  }

  unload() {
    return true;
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension(
  "GeoThreeExtension",
  GeoThreeExtension
);

(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined"
    ? factory(exports, require("three"))
    : typeof define === "function" && define.amd
    ? define(["exports", "three"], factory)
    : ((global =
        typeof globalThis !== "undefined" ? globalThis : global || self),
      factory((global.Geo = {}), global.THREE));
})(this, function (exports, three) {
  "use strict";

  class MapProvider {
    constructor() {
      this.name = "";
      this.minZoom = 0;
      this.maxZoom = 20;
      this.bounds = [];
      this.center = [];
    }
    fetchTile(zoom, x, y) {
      return null;
    }
    getMetaData() {}
  }

  class OpenStreetMapsProvider extends MapProvider {
    constructor(address = "https://a.tile.openstreetmap.org/") {
      super();
      this.address = address;
      this.format = "png";
    }
    fetchTile(zoom, x, y) {
      return new Promise((resolve, reject) => {
        const image = document.createElement("img");
        image.onload = function () {
          resolve(image);
        };
        image.onerror = function () {
          reject();
        };
        image.crossOrigin = "Anonymous";
        image.src =
          this.address + "/" + zoom + "/" + x + "/" + y + "." + this.format;
      });
    }
  }

  class MapNodeGeometry extends three.BufferGeometry {
    constructor(width, height, widthSegments, heightSegments) {
      super();
      const widthHalf = width / 2;
      const heightHalf = height / 2;
      const gridX = widthSegments + 1;
      const gridZ = heightSegments + 1;
      const segmentWidth = width / widthSegments;
      const segmentHeight = height / heightSegments;
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      for (let iz = 0; iz < gridZ; iz++) {
        const z = iz * segmentHeight - heightHalf;
        for (let ix = 0; ix < gridX; ix++) {
          const x = ix * segmentWidth - widthHalf;
          vertices.push(x, 0, z);
          normals.push(0, 1, 0);
          uvs.push(ix / widthSegments);
          uvs.push(1 - iz / heightSegments);
        }
      }
      for (let iz = 0; iz < heightSegments; iz++) {
        for (let ix = 0; ix < widthSegments; ix++) {
          const a = ix + gridX * iz;
          const b = ix + gridX * (iz + 1);
          const c = ix + 1 + gridX * (iz + 1);
          const d = ix + 1 + gridX * iz;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }

      this.addAttribute(
        "index",
        new three.BufferAttribute(new Uint32Array(indices), 1)
      );
      this.addAttribute(
        "position",
        new three.BufferAttribute(new Float32Array(vertices), 3)
      );
      this.addAttribute(
        "normal",
        new three.BufferAttribute(new Float32Array(normals), 3)
      );
      this.addAttribute(
        "uv",
        new three.BufferAttribute(new Float32Array(uvs), 2)
      );
    }
  }

  class MapNode extends three.Mesh {
    constructor(
      parentNode = null,
      mapView = null,
      location = MapNode.ROOT,
      level = 0,
      x = 0,
      y = 0,
      geometry = null,
      material = null
    ) {
      super(geometry, material);
      this.mapView = null;
      this.parentNode = null;
      this.nodesLoaded = 0;
      this.subdivided = false;
      this.childrenCache = null;
      this.isMesh = true;
      this.mapView = mapView;
      this.parentNode = parentNode;
      this.location = location;
      this.level = level;
      this.x = x;
      this.y = y;
      this.initialize();
    }
    initialize() {}
    createChildNodes() {}
    subdivide() {
      const maxZoom = this.mapView.provider.maxZoom; //Math.min(this.mapView.provider.maxZoom, this.mapView.heightProvider.maxZoom);
      if (
        this.children.length > 0 ||
        this.level + 1 > maxZoom ||
        (this.parentNode !== null &&
          this.parentNode.nodesLoaded < MapNode.CHILDRENS)
      ) {
        return;
      }
      this.subdivided = true;
      if (this.childrenCache !== null) {
        this.isMesh = false;
        this.children = this.childrenCache;
      } else {
        this.createChildNodes();
      }
    }
    simplify() {
      if (this.children.length > 0) {
        this.childrenCache = this.children;
      }
      this.subdivided = false;
      this.isMesh = true;
      this.children = [];
    }
    loadTexture() {
      this.mapView.provider
        .fetchTile(this.level, this.x, this.y)
        .then((image) => {
          const texture = new three.Texture(image);
          texture.generateMipmaps = false;
          texture.format = three.RGBFormat;
          texture.magFilter = three.LinearFilter;
          texture.minFilter = three.LinearFilter;
          texture.needsUpdate = true;
          this.material.map = texture;
          this.nodeReady();
        })
        .catch(() => {});
    }
    nodeReady() {
      if (this.parentNode !== null) {
        this.parentNode.nodesLoaded++;
        if (this.parentNode.nodesLoaded >= MapNode.CHILDRENS) {
          if (this.parentNode.subdivided === true) {
            this.parentNode.isMesh = false;
          }
          for (let i = 0; i < this.parentNode.children.length; i++) {
            this.parentNode.children[i].visible = true;
          }
        }
      } else {
        this.visible = true;
      }
    }
    getNeighborsDirection(direction) {
      return null;
    }
    getNeighbors() {
      const neighbors = [];
      return neighbors;
    }
  }
  MapNode.BASE_GEOMETRY = null;
  MapNode.BASE_SCALE = null;
  MapNode.CHILDRENS = 4;
  MapNode.ROOT = -1;
  MapNode.TOP_LEFT = 0;
  MapNode.TOP_RIGHT = 1;
  MapNode.BOTTOM_LEFT = 2;
  MapNode.BOTTOM_RIGHT = 3;

  class UnitsUtils {
    static get(onResult, onError) {
      navigator.geolocation.getCurrentPosition(function (result) {
        onResult(result.coords, result.timestamp);
      }, onError);
    }
    static datumsToSpherical(latitude, longitude) {
      const x = (longitude * UnitsUtils.EARTH_ORIGIN) / 180.0;
      let y =
        Math.log(Math.tan(((90 + latitude) * Math.PI) / 360.0)) /
        (Math.PI / 180.0);
      y = (y * UnitsUtils.EARTH_ORIGIN) / 180.0;
      return new three.Vector2(x, y);
    }
    static sphericalToDatums(x, y) {
      const longitude = (x / UnitsUtils.EARTH_ORIGIN) * 180.0;
      let latitude = (y / UnitsUtils.EARTH_ORIGIN) * 180.0;
      latitude =
        (180.0 / Math.PI) *
        (2 * Math.atan(Math.exp((latitude * Math.PI) / 180.0)) - Math.PI / 2.0);
      return { latitude: latitude, longitude: longitude };
    }
    static quadtreeToDatums(zoom, x, y) {
      const n = Math.pow(2.0, zoom);
      const longitude = (x / n) * 360.0 - 180.0;
      const latitudeRad = Math.atan(Math.sinh(Math.PI * (1.0 - (2.0 * y) / n)));
      const latitude = 180.0 * (latitudeRad / Math.PI);
      return { latitude: latitude, longitude: longitude };
    }
  }
  UnitsUtils.EARTH_RADIUS = 2 * 63781.37;
  UnitsUtils.EARTH_PERIMETER = 2 * Math.PI * UnitsUtils.EARTH_RADIUS;
  UnitsUtils.EARTH_ORIGIN = UnitsUtils.EARTH_PERIMETER / 2.0;

  class MapPlaneNode extends MapNode {
    constructor(
      parentNode = null,
      mapView = null,
      location = MapNode.ROOT,
      level = 7,
      x = 20,
      y = 49
    ) {
      // SanFrancisco level = 7, x = 20, y = 49
      super(
        parentNode,
        mapView,
        location,
        level,
        x,
        y,
        MapPlaneNode.GEOMETRY,
        new three.MeshBasicMaterial({
          disableEnvMap: true,
          depthTest: true,
          depthWrite: false,
          side: three.DoubleSide,
          transparent: false,
          wireframe: false,
        })
      );
      this.matrixAutoUpdate = false;
      this.isMesh = true;
      this.visible = false;
    }
    initialize() {
      this.loadTexture();
    }
    createChildNodes() {
      const level = this.level + 1;
      const x = this.x * 2;
      const y = this.y * 2;
      let node = new MapPlaneNode(
        this,
        this.mapView,
        MapNode.TOP_LEFT,
        level,
        x,
        y
      );
      node.scale.set(0.5, 1, 0.5);
      node.position.set(-0.25, 2, -0.25);
      this.add(node);
      node.updateMatrix();
      node.updateMatrixWorld(true);
      node = new MapPlaneNode(
        this,
        this.mapView,
        MapNode.TOP_RIGHT,
        level,
        x + 1,
        y
      );
      node.scale.set(0.5, 1, 0.5);
      node.position.set(0.25, 2, -0.25);
      this.add(node);
      node.updateMatrix();
      node.updateMatrixWorld(true);
      node = new MapPlaneNode(
        this,
        this.mapView,
        MapNode.BOTTOM_LEFT,
        level,
        x,
        y + 1
      );
      node.scale.set(0.5, 1, 0.5);
      node.position.set(-0.25, 2, 0.25);
      this.add(node);
      node.updateMatrix();
      node.updateMatrixWorld(true);
      node = new MapPlaneNode(
        this,
        this.mapView,
        MapNode.BOTTOM_RIGHT,
        level,
        x + 1,
        y + 1
      );
      node.scale.set(0.5, 1, 0.5);
      node.position.set(0.25, 2, 0.25);
      // node.renderOrder = 20-level;
      // node.sortObjects = true;
      this.add(node);
      node.updateMatrix();
      node.updateMatrixWorld(true);
    }
    raycast(raycaster, intersects) {
      if (this.isMesh === true) {
        return super.raycast(raycaster, intersects);
      }
      return false;
    }
  }
  MapPlaneNode.GEOMETRY = new MapNodeGeometry(1, 1, 1, 1);
  MapPlaneNode.BASE_GEOMETRY = MapPlaneNode.GEOMETRY;
  MapPlaneNode.BASE_SCALE = new three.Vector3(
    UnitsUtils.EARTH_PERIMETER,
    1,
    UnitsUtils.EARTH_PERIMETER
  );

  class LODRaycast {
    constructor() {
      this.subdivisionRays = 2;
      this.thresholdUp = 0.6;
      this.thresholdDown = 0.15;
      this.raycaster = new three.Raycaster();
      this.mouse = new three.Vector2();
      this.powerDistance = false;
      this.scaleDistance = true;
    }
    updateLOD(view, camera, renderer, scene, viewerImpl) {
      let intersects = [];
      for (let t = 0; t < this.subdivisionRays; t++) {
        //this.mouse.set(Math.random() * 2 - 1, Math.random() * 2 - 1);
        //this.raycaster.setFromCamera(this.mouse, camera.perspectiveCamera);

        const vpVec = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          1
        );
        const ray = new THREE.Ray();
        viewerImpl.viewportToRay(vpVec, ray);
        this.raycaster.set(ray.origin, ray.direction);

        intersects = this.raycaster.intersectObjects(view.children, true);
      }
      for (let i = 0; i < intersects.length; i++) {
        const node = intersects[i].object;
        let distance = intersects[i].distance;
        if (this.powerDistance) {
          distance = Math.pow(distance * 2, node.level);
        }
        if (this.scaleDistance) {
          const matrix = node.matrixWorld.elements;
          const vector = new three.Vector3(matrix[0], matrix[1], matrix[2]);
          distance = (1.3 * vector.length()) / distance;
        }
        if (distance > this.thresholdUp) {
          node.subdivide();
          return;
        } else if (distance < this.thresholdDown) {
          if (node.parentNode !== null) {
            node.parentNode.simplify();
            return;
          }
        }
      }
    }
  }

  class MapView extends three.Mesh {
    constructor(
      root = MapView.PLANAR,
      provider = new OpenStreetMapsProvider(),
      heightProvider = null
    ) {
      super(undefined, undefined);
      this.lod = null;
      this.provider = null;
      this.heightProvider = null;
      this.root = null;
      // doesn't work in R71
      // this.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      //     this.lod.updateLOD(this, camera, renderer, scene);
      // };
      this.lod = new LODRaycast();
      this.provider = provider;
      this.heightProvider = heightProvider;
      this.setRoot(root);
    }
    setRoot(root) {
      root = new MapPlaneNode(null, this);
      if (this.root !== null) {
        this.remove(this.root);
        this.root = null;
      }
      this.root = root;
      if (this.root !== null) {
        this.rotateX(Math.PI / 2);
        this.geometry = this.root.constructor.BASE_GEOMETRY;
        this.scale.copy(this.root.constructor.BASE_SCALE);
        this.root.mapView = this;
        this.add(this.root);
      }
    }
    setProvider(provider) {
      if (provider !== this.provider) {
        this.provider = provider;
        this.clear();
      }
    }
    setHeightProvider(heightProvider) {
      if (heightProvider !== this.heightProvider) {
        this.heightProvider = heightProvider;
        this.clear();
      }
    }
    clear() {
      this.traverse(function (children) {
        if (children.childrenCache) {
          children.childrenCache = null;
        }
        if (children.loadTexture !== undefined) {
          children.loadTexture();
        }
      });
      return this;
    }
    getMetaData() {
      this.provider.getMetaData();
    }
    raycast(raycaster, intersects) {
      return false;
    }
  }
  MapView.PLANAR = 200;
  MapView.SPHERICAL = 201;
  MapView.HEIGHT = 202;
  MapView.HEIGHT_SHADER = 203;

  class XHRUtils {
    static get(url, onLoad, onError) {
      const xhr = new XMLHttpRequest();
      xhr.overrideMimeType("text/plain");
      xhr.open("GET", url, true);
      if (onLoad !== undefined) {
        xhr.onload = function () {
          onLoad(xhr.response);
        };
      }
      if (onError !== undefined) {
        xhr.onerror = onError;
      }
      xhr.send(null);
      return xhr;
    }
    static request(url, type, header, body, onLoad, onError, onProgress) {
      function parseResponse(response) {
        try {
          return JSON.parse(response);
        } catch (e) {
          return response;
        }
      }
      const xhr = new XMLHttpRequest();
      xhr.overrideMimeType("text/plain");
      xhr.open(type, url, true);
      if (header !== null && header !== undefined) {
        for (const i in header) {
          xhr.setRequestHeader(i, header[i]);
        }
      }
      if (onLoad !== undefined) {
        xhr.onload = function (event) {
          onLoad(parseResponse(xhr.response), xhr);
        };
      }
      if (onError !== undefined) {
        xhr.onerror = onError;
      }
      if (onProgress !== undefined) {
        xhr.onprogress = onProgress;
      }
      if (body !== undefined) {
        xhr.send(body);
      } else {
        xhr.send(null);
      }
      return xhr;
    }
  }

  class BingMapsProvider extends MapProvider {
    constructor(apiKey = "", type = BingMapsProvider.AERIAL) {
      super();
      this.maxZoom = 19;
      this.format = "jpeg";
      this.mapSize = 512;
      this.subdomain = "t1";
      this.apiKey = apiKey;
      this.type = type;
    }
    getMetaData() {
      const address =
        "http://dev.virtualearth.net/REST/V1/Imagery/Metadata/RoadOnDemand?output=json&include=ImageryProviders&key=" +
        this.apiKey;
      XHRUtils.get(address, function (data) {
        JSON.parse(data);
      });
    }
    static quadKey(zoom, x, y) {
      let quad = "";
      for (let i = zoom; i > 0; i--) {
        const mask = 1 << (i - 1);
        let cell = 0;
        if ((x & mask) !== 0) {
          cell++;
        }
        if ((y & mask) !== 0) {
          cell += 2;
        }
        quad += cell;
      }
      if (quad == "") return "0";
      return quad;
    }
    fetchTile(zoom, x, y) {
      return new Promise((resolve, reject) => {
        const image = document.createElement("img");
        image.onload = function () {
          resolve(image);
        };
        image.onerror = function () {
          reject();
        };
        image.crossOrigin = "Anonymous";
        image.src =
          "http://ecn." +
          this.subdomain +
          ".tiles.virtualearth.net/tiles/" +
          this.type +
          BingMapsProvider.quadKey(zoom, x, y) +
          ".jpeg?g=1173";
      });
    }
  }
  BingMapsProvider.AERIAL = "a";
  BingMapsProvider.ROAD = "r";
  BingMapsProvider.AERIAL_LABELS = "h";
  BingMapsProvider.OBLIQUE = "o";
  BingMapsProvider.OBLIQUE_LABELS = "b";

  class CancelablePromise {
    constructor(executor) {
      this.fulfilled = false;
      this.rejected = false;
      this.called = false;
      const resolve = (v) => {
        this.fulfilled = true;
        this.value = v;
        if (typeof this.onResolve === "function") {
          this.onResolve(this.value);
          this.called = true;
        }
      };
      const reject = (reason) => {
        this.rejected = true;
        this.value = reason;
        if (typeof this.onReject === "function") {
          this.onReject(this.value);
          this.called = true;
        }
      };
      try {
        executor(resolve, reject);
      } catch (error) {
        reject(error);
      }
    }
    cancel() {
      return false;
    }
    then(callback) {
      this.onResolve = callback;
      if (this.fulfilled && !this.called) {
        this.called = true;
        this.onResolve(this.value);
      }
      return this;
    }
    catch(callback) {
      this.onReject = callback;
      if (this.rejected && !this.called) {
        this.called = true;
        this.onReject(this.value);
      }
      return this;
    }
    finally(callback) {
      return this;
    }
    static resolve(val) {
      return new CancelablePromise(function executor(resolve, _reject) {
        resolve(val);
      });
    }
    static reject(reason) {
      return new CancelablePromise(function executor(resolve, reject) {
        reject(reason);
      });
    }
    static all(promises) {
      const fulfilledPromises = [];
      const result = [];
      function executor(resolve, reject) {
        promises.forEach((promise, index) => {
          return promise
            .then((val) => {
              fulfilledPromises.push(true);
              result[index] = val;
              if (fulfilledPromises.length === promises.length) {
                return resolve(result);
              }
            })
            .catch((error) => {
              return reject(error);
            });
        });
      }
      return new CancelablePromise(executor);
    }
  }

  exports.BingMapsProvider = BingMapsProvider;
  exports.CancelablePromise = CancelablePromise;
  exports.LODRaycast = LODRaycast;
  exports.MapNode = MapNode;
  exports.MapNodeGeometry = MapNodeGeometry;
  exports.MapPlaneNode = MapPlaneNode;
  exports.MapProvider = MapProvider;
  exports.MapView = MapView;
  exports.OpenStreetMapsProvider = OpenStreetMapsProvider;
  exports.UnitsUtils = UnitsUtils;

  Object.defineProperty(exports, "__esModule", { value: true });
});
