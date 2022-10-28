/**
 * Generated by the Babylon.JS Editor v${editor-version}
 */

import { Node } from "@babylonjs/core/node";
import { Scene } from "@babylonjs/core/scene";
import { Nullable } from "@babylonjs/core/types";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Tools } from "@babylonjs/core/Misc/tools";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { SerializationHelper } from "@babylonjs/core/Misc/decorators";
import { Vector2, Vector3, Vector4, Matrix } from "@babylonjs/core/Maths/math.vector";
import { ColorGradingTexture } from "@babylonjs/core/Materials/Textures/colorGradingTexture";

import { MotionBlurPostProcess } from "@babylonjs/core/PostProcesses/motionBlurPostProcess";
import { ScreenSpaceReflectionPostProcess } from "@babylonjs/core/PostProcesses/screenSpaceReflectionPostProcess";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";

import { Image } from "@babylonjs/gui/2D/controls/image";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";

import "@babylonjs/core/Audio/audioSceneComponent";
import "@babylonjs/core/Physics/physicsEngineComponent";
import "@babylonjs/core/Engines/Extensions/engine.textureSelector";
import "@babylonjs/core/Materials/Textures/Loaders/ktxTextureLoader";

import { ISceneScriptMap } from "./scripts-map";

export type NodeScriptConstructor = (new (...args: any[]) => Node);
export type GraphScriptConstructor = (new (scene: Scene) => any);
export type ScriptMap = {
    IsGraph?: boolean;
    IsGraphAttached?: boolean;
    default: (new (...args: any[]) => NodeScriptConstructor | GraphScriptConstructor);
};

export interface IScript {
    /**
     * Called on the node is being initialized.
     * This function is called immediatly after the constructor has been called.
     */
    onInitialize?(): void;
    /**
     * Called on the node has been fully initialized and is ready.
     */
    onInitialized?(): void;
    /**
     * Called on the scene starts.
     */
    onStart?(): void;
    /**
     * Called each frame.
     */
    onUpdate?(): void;
    /**
     * Called on the object has been disposed.
     * Object can be disposed manually or when the editor stops running the scene.
     */
    onStop?(): void;

    /**
     * Called on a message has been received and sent from a graph.
     * @param message defines the name of the message sent from the graph.
     * @param data defines the data sent in the message.
     * @param sender defines the reference to the graph class that sent the message.
     */
    onMessage?(name: string, data: any, sender: any): void;

    /**
     * In case the component is decorated @guiComponent this function iscalled once the GUI data
     * has been loaded and ready to be parsed. Returns the reference to the GUI advanced dynamic texture.
     * @param parsedData defines the reference to the GUI data to be parsed coming from the server.
     */
    onGuiInitialized?(parsedData: any): AdvancedDynamicTexture;
}

export const projectConfiguration = "${project-configuration}";

/**
 * Configures the given engine according to the current project configuration (compressed textures, etc.).
 * @param engine defines the reference to the engine to configure.
 */
export function configureEngine(engine: Engine): void {
    if (projectConfiguration.compressedTextures.supportedFormats.length) {
        engine.setTextureFormatToUse(projectConfiguration.compressedTextures.supportedFormats);
    }
}

/**
 * Loads the given scene file and appends it to the given scene reference (`toScene`).
 * @param toScene defines the instance of `Scene` to append to.
 * @param rootUrl defines the root url for the scene and resources or the concatenation of rootURL and filename (e.g. http://example.com/test.glb)
 * @param sceneFilename defines the name of the scene file.
 */
export async function appendScene(toScene: Scene, rootUrl: string, sceneFilename: string): Promise<void> {
    await SceneLoader.AppendAsync(rootUrl, sceneFilename, toScene, null, ".babylon");

    return new Promise<void>((resolve) => {
        toScene.executeWhenReady(() => {
            runScene(toScene, rootUrl);
            resolve();
        });
    });
}

/**
 * Returns wether or not the given constructor is an ES6 (or more) class.
 * @param ctor defines the reference to the constructor to test.
 * @param scene defines the reference the scene in case the tested script is a graph.
 * @returns wether or not the given constructor is 
 */
function isEs6Class(ctor: any, scene: Scene): boolean {
    try {
        ctor.call({}, scene, {});
        return false;
    } catch (e) {
        return true;
    }
}

/**
 * Loads the gui data and configures the given node.
 * @param path defines the path to the GUI file to load.
 * @param node defines the reference to the node to configure.
 * @param exports defines the reference to the exported object of the attached script.
 */
async function loadGuiComponent(path: string, node: (Scene | Node | AbstractMesh) & IScript, exports: any): Promise<void> {
    let isDisposed = false;
    const disposeObserver = node.onDisposeObservable.addOnce(() => isDisposed = true);

    const dataResult = await Tools.LoadFileAsync(path, false) as string;

    if (isDisposed) {
        return;
    }

    node.onDisposeObservable.remove(disposeObserver as any);

    const data = JSON.parse(dataResult as string);

    const ui = node.onGuiInitialized?.(data);
    if (!ui) {
        return;
    }

    ui.parseContent(data, true);

    node.onDisposeObservable.addOnce(() => ui.dispose());

    // Link controls
    const controlsLinks = (exports.default as any)._ControlsValues ?? [];
    for (const link of controlsLinks) {
        const c = ui.getControlByName(link.controlName);
        node[link.propertyKey] = c;
    }

    // Link events
    const controlsClickLinks = (exports.default as any)._ControlsClickValues ?? [];
    for (const link of controlsClickLinks) {
        const c = ui.getControlByName(link.controlName);
        switch (link.type) {
            case "onPointerClickObservable": c?.onPointerClickObservable.add((i) => node[link.propertyKey](i)); break;
            case "onPointerEnterObservable": c?.onPointerEnterObservable.add((c) => node[link.propertyKey](c)); break;
            case "onPointerOutObservable": c?.onPointerOutObservable.add((c) => node[link.propertyKey](c)); break;
        }
    }

    // Replace Urls for images to fit relative path
    const images = ui.getControlsByType("Image") as Image[];
    const basePath = Tools.GetFolderPath(path);

    images.forEach((i) => {
        const source = i.source ?? "";
        if (source.startsWith("http://") || source.startsWith("https://")) {
            return;
        }

        i.source = basePath + i.source;
    });
}

/**
 * Requires the nedded scripts for the given nodes array and attach them.
 * @param scene defines the reference to the scene that contains the given nodes.
 * @param scriptsMap defines the map that contains the scripts constructors ordered by script path.
 * @param nodes the array of nodes to attach script (if exists).
 */
function requireScriptForNodes(scene: Scene, scriptsMap: ISceneScriptMap, nodes: (Node | Scene)[]): void {
    const dummyScene = new Scene(scene.getEngine(), { virtual: true });
    const initializedNodes: { node: Node | Scene; exports: any; }[] = [];

    const engine = scene.getEngine();

    // Initialize nodes
    for (const n of nodes as ((Scene | Node) & IScript)[]) {
        if (!n.metadata || !n.metadata.script || !n.metadata.script.name || n.metadata.script.name === "None") { continue; }

        const exports = scriptsMap[n.metadata.script.name] as ScriptMap;
        if (!exports) { continue; }

        const scene = n instanceof Scene ? n : n.getScene();

        // Get prototype.
        let prototype = exports.default.prototype;

        // Call constructor
        if (isEs6Class(prototype.constructor, scene)) {
            const currentScene = EngineStore.LastCreatedScene;
            EngineStore._LastCreatedScene = dummyScene;

            let clone: Nullable<Node | Scene> = null;

            if (exports.IsGraph) {
                clone = Reflect.construct(prototype.constructor.bind(n), [scene, n]);
            } else {
                const className = n.getClassName();
                switch (className) {
                    case "PointLight":
                    case "HemisphericLight":
                    case "DirectionalLight": clone = Reflect.construct(prototype.constructor, [null, Vector3.Zero(), dummyScene]); break;
                    case "SpotLight": clone = Reflect.construct(prototype.constructor, [null, Vector3.Zero(), Vector3.Zero(), 0, 0, dummyScene]); break;

                    case "InstancedMesh": clone = Reflect.construct(prototype.constructor, [null, (n as InstancedMesh).sourceMesh]); break;

                    case "TouchCamera":
                    case "UniversalCamera":
                    case "TargetCamera":
                    case "Camera":
                    case "FreeCamera": clone = Reflect.construct(prototype.constructor, [null, Vector3.Zero()]); break;
                    case "ArcRotateCamera": clone = Reflect.construct(prototype.constructor, [null, 0, 0, 0, Vector3.Zero(), dummyScene]); break;

                    default: clone = Reflect.construct(prototype.constructor, []); break;
                }
            }

            Reflect.setPrototypeOf(n, clone!.constructor.prototype);

            EngineStore._LastCreatedScene = currentScene;

            for (const key in clone) {
                if (!Reflect.has(n, key)) {
                    n[key] = clone[key];
                }
            }

            clone!.dispose();
        } else {
            if (exports.IsGraph) {
                exports.IsGraphAttached = true;
                prototype.constructor.call(n, scene, n);
            } else {
                prototype.constructor.call(n);
            }

            // Add prototype
            do {
                for (const key in prototype) {
                    if (!prototype.hasOwnProperty(key) || key === "constructor") { continue; }
                    n[key] = prototype[key].bind(n);
                }

                prototype = Object.getPrototypeOf(prototype);
            } while (prototype.constructor?.IsComponent === true);
        }

        // Call onInitialize
        n.onInitialize?.call(n);

        initializedNodes.push({ node: n, exports });
    }

    // Configure initialized nodes
    for (const i of initializedNodes) {
        const n = i.node as (Scene | Node | AbstractMesh) & IScript;
        const e = i.exports;
        const scene = i.node instanceof Scene ? i.node : i.node.getScene();

        // Check properties
        const properties = n.metadata.script.properties ?? {};
        for (const key in properties) {
            const p = properties[key];

            switch (p.type) {
                case "Vector2": n[key] = new Vector2(p.value.x, p.value.y); break;
                case "Vector3": n[key] = new Vector3(p.value.x, p.value.y, p.value.z); break;
                case "Vector4": n[key] = new Vector4(p.value.x, p.value.y, p.value.z, p.value.w); break;

                case "Color3": n[key] = new Color3(p.value.r, p.value.g, p.value.b); break;
                case "Color4": n[key] = new Color4(p.value.r, p.value.g, p.value.b, p.value.a); break;
                case "Node": n[key] = scene.getNodeById(p.value); break;
                default: n[key] = p.value; break;
            }
        }

        // Check linked children.
        if (n instanceof Node) {
            const childrenLinks = (e.default as any)._ChildrenValues ?? [];
            for (const link of childrenLinks) {
                const child = n.getChildren((node => node.name === link.nodeName), true)[0];
                n[link.propertyKey] = child;
            }
        }

        // Check linked nodes from scene.
        const sceneLinks = (e.default as any)._SceneValues ?? [];
        for (const link of sceneLinks) {
            const node = scene.getNodeByName(link.nodeName);
            n[link.propertyKey] = node;
        }

        // Check particle systems
        const particleSystemLinks = (e.default as any)._ParticleSystemValues ?? [];
        for (const link of particleSystemLinks) {
            const ps = scene.particleSystems.find((ps) => ps.name === link.particleSystemName);
            n[link.propertyKey] = ps;
        }

        // Check animation groups
        const animationGroupLinks = (e.default as any)._AnimationGroupValues ?? [];
        for (const link of animationGroupLinks) {
            const ag = scene.getAnimationGroupByName(link.animationGroupName);
            n[link.propertyKey] = ag;
        }

        // Sounds
        const soundLinks = (e.default as any)._SoundValues ?? [];
        for (const link of soundLinks) {
            switch (link.type) {
                case "global": n[link.propertyKey] = scene.mainSoundTrack.soundCollection.find((s) => s.name === link.soundName && !s.spatialSound); break;
                case "spatial": n[link.propertyKey] = scene.mainSoundTrack.soundCollection.find((s) => s.name === link.soundName && s.spatialSound); break;
                default: n[link.propertyKey] = scene.getSoundByName(link.soundName); break;
            }
        }

        // Materials
        const materialLinks = (e.default as any)._MaterialsValues ?? [];
        for (const link of materialLinks) {
            const m = scene.getMaterialByName(link.nodeName);
            n[link.propertyKey] = m;
        }

        // Check pointer events
        const pointerEvents = (e.default as any)._PointerValues ?? [];
        for (const event of pointerEvents) {
            const observer = scene.onPointerObservable.add((e) => {
                if (e.type !== event.type) { return; }
                if (!event.onlyWhenMeshPicked) { return n[event.propertyKey](e); }

                if (e.pickInfo?.pickedMesh === n) {
                    n[event.propertyKey](e);
                }
            });

            n.onDisposeObservable.addOnce(() => scene.onPointerObservable.remove(observer));
        }

        const resultCallback = () => {
            // Check start
            if (n.onStart) {
                let startObserver = scene.onBeforeRenderObservable.addOnce(() => {
                    startObserver = null!;
                    n.onStart!();
                });

                n.onDisposeObservable.addOnce(() => {
                    if (startObserver) {
                        scene.onBeforeRenderObservable.remove(startObserver);
                    }
                });
            }

            // Check update
            if (n.onUpdate) {
                const updateObserver = scene.onBeforeRenderObservable.add(() => n.onUpdate!());
                n.onDisposeObservable.addOnce(() => scene.onBeforeRenderObservable.remove(updateObserver));
            }

            // Check stop
            if (n.onStop) {
                n.onDisposeObservable.addOnce(() => n.onStop!());
            }

            // Check keyboard events
            const keyboardEvents = (e.default as any)._KeyboardValues ?? [];
            for (const event of keyboardEvents) {
                const observer = scene.onKeyboardObservable.add((e) => {
                    if (event.type && e.type !== event.type) { return; }

                    if (!event.keys.length) { return n[event.propertyKey](e); }

                    if (event.keys.indexOf(e.event.keyCode) !== -1 || event.keys.indexOf(e.event.key) !== -1) {
                        n[event.propertyKey](e);
                    }
                });

                n.onDisposeObservable.addOnce(() => scene.onKeyboardObservable.remove(observer));
            }

            // Check resize events
            const resizeEvents = (e.default as any)._ResizeValues ?? [];
            for (const event of resizeEvents) {
                const observer = engine.onResizeObservable.add((e) => {
                    n[event.propertyKey](e.getRenderWidth(), e.getRenderHeight());
                });

                n.onDisposeObservable.addOnce(() => engine.onResizeObservable.remove(observer));
            }

            // Retrieve impostors
            if (n instanceof AbstractMesh && !n.physicsImpostor) {
                n.physicsImpostor = n._scene.getPhysicsEngine()?.getImpostorForPhysicsObject(n) ?? null;
            }

            delete n.metadata.script;

            // Tell the script it has is ready
            n.onInitialized?.();
        };

        // Check asynchronous components
        const promises: Promise<unknown>[] = [];

        const guiPath = (e.default as any)._GuiPath ?? n.metadata?.guiPath;
        if (guiPath) {
            promises.push(loadGuiComponent(guiPath, n, e));
        }

        if (promises.length) {
            Promise.all(promises).then(() => resultCallback());
        } else {
            resultCallback();
        }
    }

    dummyScene.dispose();
}

/**
 * Works as an helper, this will:
 * - attach scripts on objects.
 * - configure post-processes
 * - setup rendering groups
 * @param scene the scene to attach scripts, etc.
 */
export async function runScene(scene: Scene, rootUrl?: string): Promise<void> {
    const scriptsMap = require("./scripts-map").scriptsMap;

    // Attach scripts to objects in scene.
    attachScripts(scriptsMap, scene);

    // Configure post-processes
    configurePostProcesses(scene, rootUrl);

    // Rendering groups
    setupRenderingGroups(scene);

    // Pose matrices
    applyMeshesPoseMatrices(scene);

    // Bones parenting
    attachTransformNodesToBones(scene);

    // Apply colliders
    applyMeshColliders(scene);
}

/**
 * Attaches all available scripts on nodes of the given scene.
 * @param scene the scene reference that contains the nodes to attach scripts.
 */
export function attachScripts(scriptsMap: ISceneScriptMap, scene: Scene): void {
    requireScriptForNodes(scene, scriptsMap, scene.meshes);
    requireScriptForNodes(scene, scriptsMap, scene.lights);
    requireScriptForNodes(scene, scriptsMap, scene.cameras);
    requireScriptForNodes(scene, scriptsMap, scene.transformNodes);
    requireScriptForNodes(scene, scriptsMap, [scene]);

    // Graphs
    for (const scriptKey in scriptsMap) {
        const script = scriptsMap[scriptKey];
        if (script.IsGraph && !script.IsGraphAttached) {
            const instance = new script.default(scene);
            scene.executeWhenReady(() => instance["onStart"]());
            scene.onBeforeRenderObservable.add(() => instance["onUpdate"]());
        }
    }
}

/**
 * Applies the waiting mesh colliders in case the scene is incremental.
 * @param scene defines the reference to the scene that contains the mesh colliders to apply.
 */
export function applyMeshColliders(scene: Scene): void {
    scene.meshes.forEach((m) => {
        if (m instanceof Mesh && m.metadata?.collider) {
            m._checkDelayState();
        }
    });
}

/**
 * Setups the rendering groups for meshes in the given scene.
 * @param scene defines the scene containing the meshes to configure their rendering group Ids.
 */
export function setupRenderingGroups(scene: Scene): void {
    scene.meshes.forEach((m) => {
        if (!m.metadata || !(m instanceof Mesh)) { return; }
        m.renderingGroupId = m.metadata.renderingGroupId ?? m.renderingGroupId;
    });
}

/**
 * Meshes using pose matrices with skeletons can't be parsed directly as the pose matrix is
 * missing from the serialzied data of meshes. These matrices are stored in the meshes metadata
 * instead and can be applied by calling this function.
 * @param scene defines the scene containing the meshes to configure their pose matrix.
 */
export function applyMeshesPoseMatrices(scene: Scene): void {
    scene.meshes.forEach((m) => {
        if (m.skeleton && m.metadata?.basePoseMatrix) {
            m.updatePoseMatrix(Matrix.FromArray(m.metadata.basePoseMatrix));
            delete m.metadata.basePoseMatrix;
        }
    })
}

/**
 * Checks scene's transform nodes in order to attach to related bones. 
 * @param scene defines the reference to the scene containing the transform nodes to potentially attach to bones.
 */
export function attachTransformNodesToBones(scene: Scene): void {
    const apply = (tn: TransformNode) => {
        if (!tn.metadata?.parentBoneId) { return; }

        const bone = scene.getBoneByID(tn.metadata.parentBoneId);
        if (!bone) { return; }

        const skeleton = bone.getSkeleton();
        const mesh = scene.meshes.find((m) => m.skeleton === skeleton);
        if (mesh) {
            tn.attachToBone(bone, mesh);
        }

        delete tn.metadata.parentBoneId;
    };

    scene.meshes.forEach((m) => apply(m));
    scene.transformNodes.forEach((tn) => apply(tn));
}

/**
 * Attaches the a script at runtime to the given node according to the given script's path.
 * @param scriptPath defines the path to the script to attach (available as a key in the exported "scriptsMap" map).
 * @param object defines the reference to the object (node or scene) to attach the script to.
 */
export function attachScriptToNodeAtRuntime<T extends (Node | Scene)>(scriptPath: keyof ISceneScriptMap, object: T | (Node | Scene)): T {
    const scriptsMap = require("./scripts-map").scriptsMap;

    object.metadata = object.metadata ?? {};
    object.metadata.script = object.metadata.script ?? {};
    object.metadata.script.name = scriptPath;

    requireScriptForNodes(object instanceof Scene ? object : object.getScene(), scriptsMap, [object]);

    return object as T;
}

/**
 * Defines the reference to the SSAO2 rendering pipeline.
 */
export let ssao2RenderingPipelineRef: Nullable<SSAO2RenderingPipeline> = null;
/**
 * Defines the reference to the SSR post-process.
 */
export let screenSpaceReflectionPostProcessRef: Nullable<ScreenSpaceReflectionPostProcess> = null;
/**
 * Defines the reference to the default rendering pipeline.
 */
export let defaultRenderingPipelineRef: Nullable<DefaultRenderingPipeline> = null;
/**
 * Defines the reference to the motion blur post-process.
 */
export let motionBlurPostProcessRef: Nullable<MotionBlurPostProcess> = null;

/**
 * Configures and attaches the post-processes of the given scene.
 * @param scene the scene where to create the post-processes and attach to its cameras.
 * @param rootUrl the root Url where to find extra assets used by pipelines. Should be the same as the scene.
 */
export function configurePostProcesses(scene: Scene, rootUrl: Nullable<string> = null): void {
    if (rootUrl === null || !scene.metadata?.postProcesses) { return; }

    // Load  post-processes configuration
    const data = scene.metadata.postProcesses;

    if (data.ssao && !ssao2RenderingPipelineRef) {
        ssao2RenderingPipelineRef = SSAO2RenderingPipeline.Parse(data.ssao.json, scene, rootUrl);
        if (data.ssao.enabled) {
            scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(ssao2RenderingPipelineRef.name, scene.cameras);
        }
    }

    if (data.screenSpaceReflections?.json && !screenSpaceReflectionPostProcessRef) {
        // screenSpaceReflectionPostProcessRef = ScreenSpaceReflectionPostProcess._Parse(data.screenSpaceReflections.json, scene.activeCamera!, scene, "");
        screenSpaceReflectionPostProcessRef = new ScreenSpaceReflectionPostProcess("ssr", scene, 1.0, scene.activeCamera!);
        screenSpaceReflectionPostProcessRef.step = data.screenSpaceReflections.json.step;
        screenSpaceReflectionPostProcessRef.strength = data.screenSpaceReflections.json.strength;
        screenSpaceReflectionPostProcessRef.threshold = data.screenSpaceReflections.json.threshold;
        screenSpaceReflectionPostProcessRef.smoothSteps = data.screenSpaceReflections.json.smoothSteps;
        screenSpaceReflectionPostProcessRef.roughnessFactor = data.screenSpaceReflections.json.roughnessFactor;
        screenSpaceReflectionPostProcessRef.reflectionSamples = data.screenSpaceReflections.json.reflectionSamples;
        screenSpaceReflectionPostProcessRef.enableSmoothReflections = data.screenSpaceReflections.json.enableSmoothReflections;
    }

    if (data.default && !defaultRenderingPipelineRef) {
        defaultRenderingPipelineRef = new DefaultRenderingPipeline(data.default.json.name, true, scene);

        defaultRenderingPipelineRef.fxaaEnabled = data.default.json.fxaa.enabled;

        // Image processing
        defaultRenderingPipelineRef.imageProcessingEnabled = data.default.json.imageProcessing.enabled;
        defaultRenderingPipelineRef.imageProcessing.exposure = data.default.json.imageProcessing.exposure;
        defaultRenderingPipelineRef.imageProcessing.contrast = data.default.json.imageProcessing.contrast;
        defaultRenderingPipelineRef.imageProcessing.fromLinearSpace = data.default.json.imageProcessing.fromLinearSpace;
        defaultRenderingPipelineRef.imageProcessing.toneMappingEnabled = data.default.json.imageProcessing.toneMappingEnabled;
        
        defaultRenderingPipelineRef.imageProcessing.colorCurvesEnabled = data.default.json.imageProcessing.colorCurvesEnabled;
        defaultRenderingPipelineRef.imageProcessing.colorGradingEnabled = data.default.json.imageProcessing.colorGradingEnabled;

        if (data.default.json.imageProcessing.colorCurves) {
            defaultRenderingPipelineRef.imageProcessing.colorCurves = ColorCurves.Parse(data.default.json.imageProcessing.colorCurves);
        }

        if (data.default.json.imageProcessing.colorGradingTexture) {
            data.default.json.imageProcessing.colorGradingTexture.name = rootUrl + data.default.json.imageProcessing.colorGradingTexture.name;
            defaultRenderingPipelineRef.imageProcessing.colorGradingTexture = ColorGradingTexture.Parse(data.default.json.imageProcessing.colorGradingTexture, scene);
        }

        // Vignette
        defaultRenderingPipelineRef.imageProcessing.vignetteEnabled = data.default.json.vignette.enabled;
        defaultRenderingPipelineRef.imageProcessing.vignetteWeight = data.default.json.vignette.vignetteWeight;
        defaultRenderingPipelineRef.imageProcessing.vignetteBlendMode = data.default.json.vignette.vignetteBlendMode;
        defaultRenderingPipelineRef.imageProcessing.vignetteColor = Color4.FromArray(data.default.json.vignette.vignetteColor);

        // Sharpen
        defaultRenderingPipelineRef.sharpenEnabled = data.default.json.sharpen.enabled;
        defaultRenderingPipelineRef.sharpen.edgeAmount = data.default.json.sharpen.edgeAmount;
        defaultRenderingPipelineRef.sharpen.colorAmount = data.default.json.sharpen.colorAmount;

        // Bloom
        defaultRenderingPipelineRef.bloomEnabled = data.default.json.bloom.enabled;
        defaultRenderingPipelineRef.bloomScale = data.default.json.bloom.bloomScale;
        defaultRenderingPipelineRef.bloomWeight = data.default.json.bloom.bloomWeight;
        defaultRenderingPipelineRef.bloomKernel = data.default.json.bloom.bloomKernel;
        defaultRenderingPipelineRef.bloomThreshold = data.default.json.bloom.bloomThreshold;

        // Depth of field
        defaultRenderingPipelineRef.depthOfFieldEnabled = data.default.json.depthOfField.enabled;
        defaultRenderingPipelineRef.depthOfField.fStop = data.default.json.depthOfField.fStop;
        defaultRenderingPipelineRef.depthOfField.focalLength = data.default.json.depthOfField.focalLength;
        defaultRenderingPipelineRef.depthOfField.focusDistance = data.default.json.depthOfField.focusDistance;
        defaultRenderingPipelineRef.depthOfFieldBlurLevel = data.default.json.depthOfField.depthOfFieldBlurLevel;

        // Chromatic aberration
        defaultRenderingPipelineRef.chromaticAberrationEnabled = data.default.json.chromaticAberration.enabled;
        defaultRenderingPipelineRef.chromaticAberration.aberrationAmount = data.default.json.chromaticAberration.aberrationAmount;
        defaultRenderingPipelineRef.chromaticAberration.radialIntensity = data.default.json.chromaticAberration.radialIntensity;
        defaultRenderingPipelineRef.chromaticAberration.direction = Vector2.FromArray(data.default.json.chromaticAberration.direction);
        defaultRenderingPipelineRef.chromaticAberration.centerPosition = Vector2.FromArray(data.default.json.chromaticAberration.centerPosition);

        // Grain
        defaultRenderingPipelineRef.grainEnabled = data.default.json.grain.enabled;
        defaultRenderingPipelineRef.grain.animated = data.default.json.grain.animated;
        defaultRenderingPipelineRef.grain.intensity = data.default.json.grain.intensity;

        // Glow
        defaultRenderingPipelineRef.glowLayerEnabled = data.default.json.glowLayer.enabled;
        if (defaultRenderingPipelineRef.glowLayer) {
            defaultRenderingPipelineRef.glowLayer.intensity = data.default.json.glowLayer.intensity;
            defaultRenderingPipelineRef.glowLayer.blurKernelSize = data.default.json.glowLayer.blurKernelSize;
        }

        if (!data.default.enabled) {
            scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(defaultRenderingPipelineRef.name, scene.cameras);
        }
    }

    if (data.motionBlur?.json) {
        // motionBlurPostProcessRef = MotionBlurPostProcess._Parse(data.motionBlur.json, scene.activeCamera!, scene, "");
        motionBlurPostProcessRef = new MotionBlurPostProcess(data.motionBlur.json.name, scene, 1.0, scene.activeCamera!);
        motionBlurPostProcessRef.isObjectBased = data.motionBlur.json.isObjectBased;
        motionBlurPostProcessRef.motionStrength = data.motionBlur.json.motionStrength;
        motionBlurPostProcessRef.motionBlurSamples = data.motionBlur.json.motionBlurSamples;
    }

    scene.onDisposeObservable.addOnce(() => {
        ssao2RenderingPipelineRef = null;
        screenSpaceReflectionPostProcessRef = null;
        defaultRenderingPipelineRef = null;
        motionBlurPostProcessRef = null;
    });
}

/**
 * Overrides the texture parser.
 */
(function overrideTextureParser(): void {
    const textureParser = SerializationHelper._TextureParser;
    SerializationHelper._TextureParser = (sourceProperty, scene, rootUrl) => {
        if (sourceProperty.isCube && !sourceProperty.isRenderTarget && sourceProperty.files && sourceProperty.metadata?.isPureCube) {
            sourceProperty.files.forEach((f, index) => {
                sourceProperty.files[index] = rootUrl + f;
            });
        }

        const texture = textureParser.call(SerializationHelper, sourceProperty, scene, rootUrl);

        if (sourceProperty.url && texture instanceof Texture) {
            texture.url = rootUrl + sourceProperty.url;
        }

        return texture;
    };
})();
