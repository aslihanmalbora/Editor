import { Nullable } from "../../../../shared/types";

import * as React from "react";
import { Tooltip } from "@blueprintjs/core";

import { TransformNode } from "babylonjs";

import { Editor } from "../../editor";

import { InspectorNotifier } from "../../gui/inspector/notifier";

import { Tools } from "../../tools/tools";
import { undoRedo } from "../../tools/undo-redo";

import { IDragAndDroppedAssetComponentItem } from "../../assets/abstract-assets";

import { moveNodes } from "./tools/move";
import { getNodeId, isDraggable, isNode } from "./tools/tools";

export interface IGraphLabelProps {
    /**
     * Defines the reference to the editor.
     */
    editor: Editor;
    /**
     * Defines the reference to the object to show in the graph.
     */
    object: any;
}

export interface IGraphLabelState {
    /**
     * Defines the current opacity of the label.
     */
    opacity?: string;
    /**
     * Defines the current background color of the label.
     */
    backgroundColor?: string;
}

export class GraphLabel extends React.Component<IGraphLabelProps, IGraphLabelState> {
    private _isDraggable: boolean;

    private _dropListener: Nullable<(ev: DragEvent) => void> = null;

    /**
     * Constructor.
     * @param props defines the component's props.
     */
    public constructor(props: IGraphLabelProps) {
        super(props);

        this._isDraggable = isDraggable(props.object);

        this.state = {
            opacity: undefined,
            backgroundColor: undefined,
        };
    }

    /**
     * Renders the component.
     */
    public render(): React.ReactNode {
        const isLocked = this.props.object.metadata?.isLocked;
        const doNotExport = this.props.object.metadata?.doNotExport;
        const hasScript = this.props.object.metadata?.script?.name && this.props.object.metadata?.script.name !== "None";

        return (
            <div
                draggable={this._isDraggable}
                style={{
                    width: "100%",
                    height: "100%",
                    opacity: this.state.opacity,
                    backgroundColor: this.state.backgroundColor,
                }}
                onDrop={(e) => this._handleDrop(e)}
                onDragEnd={(e) => this._handleDragEnd(e)}
                onDragStart={(e) => this._handleDragStart(e)}
                onDragEnter={(e) => this._handleDragEnter(e)}
                onDragLeave={(e) => this._handleDragLeave(e)}
            >
                <Tooltip
                    usePortal
                    position="top"
                    content={<span>{Tools.GetConstructorName(this.props.object)}</span>}
                >
                    <span
                        onDragOver={(e) => this._handleDragEnter(e)}
                        style={{
                            height: "100%",
                            lineHeight: "30px",

                            color: hasScript ? "#48aff0" : undefined,
                            opacity: (doNotExport || isLocked) ? "0.5" : undefined,
                            textDecoration: doNotExport ? "line-through" : undefined,

                            ...(this.props.object.metadata?.editorGraphStyles ?? {}),
                        }}
                    >
                        {this.props.object.name}
                    </span>
                </Tooltip>
            </div>
        );
    }

    /**
     * Called on the user drops an element on this label.
     */
    private _handleDrop(event: React.DragEvent<HTMLSpanElement>): void {
        event.stopPropagation();

        this.setState({ backgroundColor: undefined });

        if (event.dataTransfer?.getData("graph/node")) {
            return this._handleNodeDrop(event);
        }

        return this._handleExternalDrop(event);
    }

    /**
     * Called on the user stops drag'n'dropping the node.
     */
    private _handleDragEnd(_: React.DragEvent<HTMLSpanElement>): void {
        this.setState({ opacity: undefined });

        if (this._dropListener) {
            this.props.editor.engine!.getRenderingCanvas()?.removeEventListener("drop", this._dropListener);
            this._dropListener = null;
        }
    }

    /**
     * Called on the user starts drag'n'dropping the node.
     */
    private _handleDragStart(event: React.DragEvent<HTMLSpanElement>): void {
        this.setState({ opacity: "0.5" });

        const selected = this.props.editor.graph.state.selectedNodes.find((n) => n.nodeData === this.props.object);
        if (!selected) {
            this.props.editor.graph.setSelected(this.props.object);
        }

        const nodeId = getNodeId(this.props.object);
        if (nodeId) {
            event.dataTransfer?.setData("graph/node", JSON.stringify({
                nodeId,
                allNodeIds: this.props.editor.graph.state.selectedNodes.map((n) => n.id),
            }));

            InspectorNotifier._DragAndDroppedGraphItem = {
                nodeId,
                onDropInInspector: async (_, object, property) => {
                    object[property] = nodeId;
                },
            };
        }

        this.props.editor.engine?.getRenderingCanvas()?.addEventListener("drop", this._dropListener = (dropEv) => {
            this._handleCanvasDrop(dropEv);
        });
    }

    /**
     * Called on the drag'n'drop event enters the current component.
     */
    private _handleDragEnter(_: React.DragEvent<HTMLSpanElement>): void {
        this.setState({ backgroundColor: "grey" });
    }

    /**
     * Called on the drag'n'drop event leaves the current component.
     */
    private _handleDragLeave(_: React.DragEvent<HTMLSpanElement>): void {
        this.setState({ backgroundColor: undefined });
    }

    /**
     * Called on the user drops grapn nodes on the node.
     */
    private _handleNodeDrop(event: React.DragEvent<HTMLSpanElement>): void {
        if (!isNode(this.props.object)) {
            return;
        }

        const droppedNodes = this.props.editor.graph.state.selectedNodes
            .filter((n) => n.nodeData !== this.props.object)
            .map((n) => n.nodeData);

        moveNodes(this.props.editor, droppedNodes, this.props.object, event.shiftKey);
    }

    /**
     * Called on the user drops external resources on the node.
     */
    private _handleExternalDrop(event: React.DragEvent<HTMLSpanElement>): void {
        let objects = this.props.editor.graph.state.selectedNodes.map((n) => n.nodeData);
        if (!objects.includes(this.props.object)) {
            objects = [this.props.object];
        }

        const nodes = objects.filter((n) => isNode(n));

        // Check for assets
        const components = this.props.editor.assets.getAssetsComponents();
        for (const c of components) {
            if (!c._id || !c._ref?.dragAndDropType) {
                continue;
            }

            try {
                const data = JSON.parse(event.dataTransfer.getData(c._ref.dragAndDropType)) as IDragAndDroppedAssetComponentItem;

                if (c._id !== data.assetComponentId) {
                    continue;
                }

                if (c._ref.onGraphDropAsset(data, nodes)) {
                    return;
                }
            } catch (e) {
                // Catch silently.
            }
        }

        // Check for external drop
        if (InspectorNotifier._DragAndDroppedAssetItem) {
            InspectorNotifier._DragAndDroppedAssetItem.onDropInGraph(event, objects);
        }
    }

    /**
     * Called on the user drops an element of the graph on the preview's canvas.
     */
    private _handleCanvasDrop(event: DragEvent): void {
        if (!event.dataTransfer?.getData("graph/node")) {
            return;
        }

        const scene = this.props.editor.scene!;
        const pick = scene.pick(event.offsetX, event.offsetY);

        if (!pick?.pickedPoint) {
            return;
        }

        const selectedNodes = this.props.editor.graph.state.selectedNodes
            .filter((n) => n.nodeData instanceof TransformNode)
            .map((n) => n.nodeData) as TransformNode[];

        if (!selectedNodes.length) {
            return;
        }

        const oldAbsolutePositions = selectedNodes.map((n) => n.getAbsolutePosition().clone());

        undoRedo.push({
            common: () => this.props.editor.inspector.refresh(),
            undo: () => selectedNodes.forEach((n, index) => n.setAbsolutePosition(oldAbsolutePositions[index])),
            redo: () => selectedNodes.forEach((n) => n.setAbsolutePosition(pick.pickedPoint!)),
        });
    }
}