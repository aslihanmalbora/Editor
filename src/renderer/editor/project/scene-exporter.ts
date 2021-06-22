import { basename, dirname, extname, join } from "path";
import directoryTree, { DirectoryTree } from "directory-tree";
import { copy, pathExists, readdir, readFile, readJSON, remove, writeFile, writeJSON } from "fs-extra";

import { LGraph } from "litegraph.js";
import { SceneSerializer, Mesh } from "babylonjs";

import { Editor } from "../editor";

import { FSTools } from "../tools/fs";
import { Tools } from "../tools/tools";
import { KTXTools, KTXToolsType } from "../tools/ktx";
import { MaterialTools } from "../tools/components/material";

import { SceneSettings } from "../scene/settings";
import { SceneExportOptimzer } from "../scene/export-optimizer";

import { Project } from "./project";
import { WorkSpace } from "./workspace";

import { GraphAssets } from "../assets/graphs";

import { GraphCode } from "../graph/graph";
import { GraphCodeGenerator } from "../graph/generate";

import { GeometryExporter } from "../export/geometry";

export interface IExportFinalSceneOptions {
	/**
	 * defines the optional path where to save to final scene.
	 */
	destPath?: string;
	/**
	 * Defines the root path applied on geometries in .babylon file in case of incremental loading.
	 */
	geometryRootPath?: string;

	/**
	 * Defines wether or not files are forced to be re-generated.
	 */
	forceRegenerateFiles?: boolean;
	/**
	 * Defines wether or not all compressed texture formats should be generated.
	 * Typically used when exporting final scene version.
	 */
	generateAllCompressedTextureFormats?: boolean;
}

export class SceneExporter {
	public static readonly CopyAbleImageTypes: string[] = [
		".png", ".jpeg", ".jpg", ".bmp",
	];

	/**
	 * Defines the list of all files types that are copy-able for the
	 * final assets output folder.
	 */
	public static readonly CopyAbleAssetsTypes: string[] = [
		...SceneExporter.CopyAbleImageTypes,
		".env", ".dds",
		".mp3", ".wav", ".ogg", ".wave",
	];

	private static _IsExporting: boolean = false;

	/**
	 * Exports the final scene and asks for the destination folder.
	 * @param editor defines the reference to the editor.
	 */
	public static async ExportFinalSceneAs(editor: Editor): Promise<void> {
		const destPath = await Tools.ShowSaveDialog();
		if (!destPath) { return; }

		return this.ExportFinalScene(editor, undefined, { destPath });
	}

	/**
	 * Eports the final scene.
	 * @param editor the editor reference.
	 * @param task defines the already existing task feedback to reuse.
	 * @param destPath defines the optional path where to save to final scene.
	 */
	public static async ExportFinalScene(editor: Editor, task?: string, options?: IExportFinalSceneOptions): Promise<void> {
		if (this._IsExporting) {
			return;
		}

		this._IsExporting = true;

		try {
			await this._ExportFinalScene(editor, task, options);
		} catch (e) {
			console.error(e);
			editor.console.logError(e.message);
		}

		this._IsExporting = false;
	}

	/**
	 * Exports the current scene into .babylon format including only geometries.
	 * @param editor defines the reference to the editor.
	 */
	public static async ExportFinalSceneOnlyGeometries(editor: Editor): Promise<void> {
		// Generate scene
		const scene = SceneExporter.GetFinalSceneJson(editor);
		if (!scene) { return; }

		scene.materials = [];
		scene.lights = [];
		scene.cameras = [];
		scene.shadowGenerators = [];
		scene.particleSystems = [];
		scene.meshes?.forEach((m) => m.materialId = null);

		// Save
		let destPath = await Tools.ShowSaveFileDialog("Save Scene (Only Geometries)");
		if (!destPath) { return; }

		if (extname(destPath).toLowerCase() !== ".babylon") {
			destPath += ".babylon";
		}

		await writeFile(destPath, JSON.stringify(scene), { encoding: "utf-8" });
	}

	/**
	 * Returns the final scene in its JSON representation.
	 * @param editor defines the reference to the editor.
	 */
	public static GetFinalSceneJson(editor: Editor): any {
		// Sounds
		if (editor.scene!.soundTracks?.indexOf(editor.scene!.mainSoundTrack) === -1) {
			editor.scene!.soundTracks.push(editor.scene!.mainSoundTrack);
		}

		// Optimize
		const optimizer = new SceneExportOptimzer(editor.scene!);
		optimizer.optimize();

		// Configure nodes that are not serializable.
		Tools.getAllSceneNodes(editor.scene!).forEach((n) => {
			if (n.metadata?.doNotExport === true) {
				n.doNotSerialize = true;
			}
		});

		const scene = SceneSerializer.Serialize(editor.scene!);
		scene.metadata = scene.metadata ?? {};
		scene.metadata.postProcesses = {
			ssao: { enabled: SceneSettings.IsSSAOEnabled(), json: SceneSettings.SSAOPipeline?.serialize() },
			screenSpaceReflections: { enabled: SceneSettings.IsScreenSpaceReflectionsEnabled(), json: SceneSettings.ScreenSpaceReflectionsPostProcess?.serialize() },
			default: { enabled: SceneSettings.IsDefaultPipelineEnabled(), json: SceneSettings.DefaultPipeline?.serialize() },
			motionBlur: { enabled: SceneSettings.IsMotionBlurEnabled(), json: SceneSettings.MotionBlurPostProcess?.serialize() },
		};

		// Set producer
		scene.producer = {
			file: "scene.babylon",
			name: "Babylon.JS Editor",
			version: `v${editor._packageJson.version}`,
			exporter_version: `v${editor._packageJson.dependencies.babylonjs}`,
		};

		// Active camera
		scene.activeCameraID = scene.cameras[0]?.id;

		// LODs
		scene.meshes?.forEach((m) => {
			if (!m) { return; }

			delete m.renderOverlay;

			const exportedMeshMetadata = m.metadata;
			const waitingUpdatedReferences = exportedMeshMetadata?._waitingUpdatedReferences;
			if (waitingUpdatedReferences) {
				delete m.metadata._waitingUpdatedReferences;
				m.metadata = Tools.CloneObject(m.metadata);
				exportedMeshMetadata._waitingUpdatedReferences = waitingUpdatedReferences;
			}

			const mesh = editor.scene!.getMeshByID(m.id);
			if (!mesh || !(mesh instanceof Mesh)) { return; }

			const lods = mesh.getLODLevels();
			if (!lods.length) { return; }

			m.lodMeshIds = lods.map((lod) => lod.mesh?.id);
			m.lodDistances = lods.map((lod) => lod.distance);
			m.lodCoverages = lods.map((lod) => lod.distance);
		});

		// Physics
		scene.physicsEnabled = Project.Project?.physicsEnabled ?? true;
		if (scene.physicsEngine && WorkSpace.Workspace?.physicsEngine) {
			scene.physicsEngine = WorkSpace.Workspace?.physicsEngine;
		}

		scene.meshes?.forEach((m) => {
			const existingMesh = editor.scene!.getMeshByID(m.id);
			if (!existingMesh) { return; }

			if (scene.physicsEnabled) {
				if (existingMesh.physicsImpostor) {
					m.physicsRestitution = existingMesh.physicsImpostor.getParam("restitution");
				}
			} else {
				delete m.physicsImpostor;
				delete m.physicsMass;
				delete m.physicsFriction;
				delete m.physicsRestitution;
			}

			m.instances?.forEach((i) => {
				const instance = existingMesh._scene.getMeshByID(i.id);
				if (!instance?.physicsImpostor) { return; }

				if (scene.physicsEnabled) {
					i.physicsRestitution = instance.physicsImpostor.getParam("restitution");
				} else {
					delete i.physicsImpostor;
					delete i.physicsMass;
					delete i.physicsFriction;
					delete i.physicsRestitution;
				}
			});
		});

		// Skeletons
		scene.skeletons?.forEach((s) => {
			s.bones?.forEach((b) => {
				if (!b.metadata) { return; }
				b.id = b.metadata.originalId;
			});
		});

		// PBR materials
        scene.materials?.forEach((m) => {
            if (m.customType === "BABYLON.PBRMaterial" && m.environmentBRDFTexture) {
                delete m.environmentBRDFTexture;
            }
        });

		// Clean
		optimizer.clean();

		// Restore nodes that are not serialized.
		Tools.getAllSceneNodes(editor.scene!).forEach((n) => {
			if (n.metadata?.doNotExport === true) {
				n.doNotSerialize = false;
			}
		});

		return scene;
	}

	/**
	 * Returns the location of the exported scene on the file system.
	 */
	public static GetExportedSceneLocation(): string {
		const projectName = basename(dirname(WorkSpace.Workspace!.lastOpenedScene));
		return join(WorkSpace.DirPath!, "scenes", projectName);
	}

	/**
	 * Eports the final scene.
	 */
	private static async _ExportFinalScene(editor: Editor, task?: string, options?: IExportFinalSceneOptions): Promise<void> {
		if (!WorkSpace.HasWorkspace()) { return; }

		// Check is isolated mode
		if (editor.preview.state.isIsolatedMode) {
			return editor.notifyMessage("Can't export when Isolated Mode is enabled.", 2000, "error");
		}

		editor.console.logSection("Exporting Final Scene");

		task = task ?? editor.addTaskFeedback(0, "Generating Final Scene");
		editor.updateTaskFeedback(task, 0, "Generating Final Scene");

		editor.console.logInfo("Serializing scene...");
		const scene = SceneExporter.GetFinalSceneJson(editor);

		const assetsPath = join(WorkSpace.DirPath!, "scenes/_assets");

		await FSTools.CreateDirectory(join(WorkSpace.DirPath!, "scenes"));
		await FSTools.CreateDirectory(assetsPath);

		const scenePath = options?.destPath ?? this.GetExportedSceneLocation();
		await FSTools.CreateDirectory(scenePath);

		editor.updateTaskFeedback(task, 50);
		editor.beforeGenerateSceneObservable.notifyObservers(scenePath);

		// Handle incremental loading
		const geometriesPath = join(scenePath, "geometries");
		const incrementalFolderExists = await pathExists(geometriesPath);

		if (incrementalFolderExists) {
			const incrementalFiles = await readdir(geometriesPath);

			try {
				await Promise.all(incrementalFiles.map((f) => remove(join(geometriesPath, f))));
			} catch (e) {
				editor.console.logError("Failed to remove incremental geometry file");
			}
		}

		if (!WorkSpace.Workspace?.useIncrementalLoading) {
			try {
				await remove(geometriesPath);
			} catch (e) {
				editor.console.logError("Failed to remove geometries output folder.");
			}
		} else {
			if (!incrementalFolderExists) {
				await FSTools.CreateDirectory(geometriesPath);
			}

			const geometryRootPath = options?.geometryRootPath ?? `../${WorkSpace.GetProjectName()}/`;
			await GeometryExporter.ExportIncrementalGeometries(editor, geometriesPath, scene, true, geometryRootPath, task);
		}

		// Copy assets files
		const assetsTree = directoryTree(editor.assetsBrowser.assetsDirectory);
		await this._RecursivelyWriteAssets(editor, assetsTree, editor.assetsBrowser.assetsDirectory, assetsPath, options);

		// Handle node material textures
		editor.updateTaskFeedback(task, 70, "Generating Node Material textures...");
		await MaterialTools.ExportSerializedNodeMaterialsTextures(editor, scene.materials, editor.assetsBrowser.assetsDirectory, assetsPath);

		// Write scene
		editor.updateTaskFeedback(task, 50, "Writing scene...");
		await writeJSON(join(scenePath, "scene.babylon"), scene);

		// Tools
		await this.GenerateScripts(editor);

		editor.updateTaskFeedback(task, 100);
		editor.closeTaskFeedback(task, 1000);

		editor.afterGenerateSceneObservable.notifyObservers(scenePath);
		editor.console.logInfo(`Successfully generated scene at ${scenePath}`);
	}

	/**
	 * Recursively re-creates the assets structure in the output folder and copies the supported files.
	 */
	private static async _RecursivelyWriteAssets(editor: Editor, directoryTree: DirectoryTree, assetsPath: string, outputPath: string, options?: IExportFinalSceneOptions): Promise<void> {
		if (directoryTree.type === "directory" && directoryTree.children?.length) {
			const path = directoryTree.path.replace(assetsPath, outputPath);
			await FSTools.CreateDirectory(path);
		}
		
		const promises: Promise<void>[] = [];

		for (const child of directoryTree.children ?? []) {
			if (child.type !== "file") {
				continue;
			}

			const path = child.path.replace(assetsPath, outputPath);
			
			const extension = extname(child.name).toLowerCase();
			if (this.CopyAbleAssetsTypes.indexOf(extension) === -1) {
				continue;
			}
	
			if (!(await pathExists(path))) {
				await copy(child.path, path);
				editor.console.logInfo(`Copied asset file at: ${path}`);
			}

			// KTX
			if (this.CopyAbleImageTypes.indexOf(extension) === -1) {
				continue;
			}
	
			const ktx2CompressedTextures = WorkSpace.Workspace!.ktx2CompressedTextures;
	
			const forcedFormat = ktx2CompressedTextures?.forcedFormat ?? "automatic";
			const supportedTextureFormat = (forcedFormat !== "automatic" ? forcedFormat : editor.engine!.texturesSupported[0]) as KTXToolsType;
	
			if (supportedTextureFormat && ktx2CompressedTextures?.enabled && ktx2CompressedTextures.pvrTexToolCliPath) {
				const destFilesDir = dirname(path);
	
				if (options?.generateAllCompressedTextureFormats) {
					await Promise.all([
						KTXTools.CompressTexture(editor, path, destFilesDir, "-astc.ktx"),
						KTXTools.CompressTexture(editor, path, destFilesDir, "-dxt.ktx"),
						KTXTools.CompressTexture(editor, path, destFilesDir, "-pvrtc.ktx"),
						KTXTools.CompressTexture(editor, path, destFilesDir, "-etc1.ktx"),
						KTXTools.CompressTexture(editor, path, destFilesDir, "-etc2.ktx"),
					]);
				} else {
					const ktxFilename = KTXTools.GetKtxFileName(path, supportedTextureFormat);
					if (!options?.forceRegenerateFiles && await pathExists(ktxFilename)) {
						continue;
					}
	
					promises.push(KTXTools.CompressTexture(editor, path, destFilesDir, supportedTextureFormat));
				}
			}
		}

		await Promise.all(promises);

		for (const child of directoryTree.children ?? []) {
			await this._RecursivelyWriteAssets(editor, child, assetsPath, outputPath, options);
		}
	}

	/**
	 * Generates the scripts for the project. Will wirte the "tools.ts" file and all index.ts files.
	 * @param editor defines the reference to the editor.
	 */
	public static async GenerateScripts(editor: Editor): Promise<void> {
		// Copy tools
		editor.console.logInfo("Copyging tools...");

		const decorators = await readFile(join(Tools.GetAppPath(), "assets", "scripts", "decorators.ts"), { encoding: "utf-8" });
		await writeFile(join(WorkSpace.DirPath!, "src", "scenes", "decorators.ts"), decorators, { encoding: "utf-8" });

		const tools = await readFile(join(Tools.GetAppPath(), "assets", "scripts", "tools.ts"), { encoding: "utf-8" });
		const finalTools = tools// .replace("// ${decorators}", decorators)
			.replace("${editor-version}", editor._packageJson.version);

		await writeFile(join(WorkSpace.DirPath!, "src", "scenes", "tools.ts"), finalTools, { encoding: "utf-8" });

		// Export scripts
		editor.console.logInfo("Configuring scripts...");
		const scriptsMap = await readFile(join(Tools.GetAppPath(), "assets", "scripts", "scripts-map.ts"), { encoding: "utf-8" });
		const newScriptsMap = await this._UpdateScriptContent(editor, scriptsMap);
		await writeFile(join(WorkSpace.DirPath!, "src", "scenes", "scripts-map.ts"), newScriptsMap, { encoding: "utf-8" });

		// Export scene content
		editor.console.logInfo("Configuring scene entry point...");
		const scriptsContent = await readFile(join(Tools.GetAppPath(), "assets", "scripts", "scene", "index.ts"), { encoding: "utf-8" });

		const indexPath = join(WorkSpace.DirPath!, "src", "scenes", WorkSpace.GetProjectName());

		await FSTools.CreateDirectory(indexPath);

		await writeFile(join(indexPath, "index.ts"), scriptsContent, { encoding: "utf-8" });
	}

	/**
	 * Exports all available graphs in the scene.
	 * @param editor defines the reference to the editor.
	 */
	public static async ExportGraphs(editor: Editor): Promise<void> {
		// Write all graphs
		const destGraphs = join(WorkSpace.DirPath!, "src", "scenes", WorkSpace.GetProjectName(), "graphs");

		await FSTools.CreateDirectory(destGraphs);

		const graphs = editor.assets.getAssetsOf(GraphAssets);
		if (graphs?.length) {
			GraphCode.Init();
			await GraphCodeGenerator.Init();
		}

		for (const g of graphs ?? []) {
			const extension = extname(g.id);
			const name = g.id.replace(extension, "");
			const json = await readJSON(g.key);

			try {
				const code = GraphCodeGenerator.GenerateCode(new LGraph(json))?.replace("${editor-version}", editor._packageJson.version);
				await writeFile(join(destGraphs, `${name}.ts`), code);
			} catch (e) {
				console.error(e);
			}
		}
	}

	/**
	 * Updates the script content to be written.
	 */
	private static async _UpdateScriptContent(editor: Editor, scriptsContent: string): Promise<string> {
		// Write all graphs.
		await this.ExportGraphs(editor);

		// Export scripts.
		const all = await editor.assetsBrowser.getAllScripts();
		return scriptsContent.replace("${editor-version}", editor._packageJson.version).replace("// ${scripts}", all.map((s) => {
			const toReplace = `src/scenes/`;
			const extension = extname(s);
			return `\t"${s}": require("./${s.replace(toReplace, "").replace(extension, "")}"),`;
		}).join("\n")).replace("// ${scriptsInterface}", all.map((s) => {
			return `\t"${s}": any;`;
		}).join("\n"));
	}
}