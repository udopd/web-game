import React, { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useStudio } from "./store";
import type { Definition } from "../../../packages/content-schemas/src/definitions";
export function GraphStudio() {
  const { draft, selection, edit, ui } = useStudio();
  const campaign = selection?.collection === "campaigns";
  const data =
    selection && (campaign || selection.collection === "graphs")
      ? (draft?.content[selection.collection].items.find(
          (x) => x.id === selection.id,
        ) as Definition<"graphs"> | Definition<"campaigns"> | undefined)
      : undefined;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]),
    [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [type, setType] = useState("action");
  const positions = (draft?.ui[`graph.${data?.id}`] ?? {}) as Record<
    string,
    { x: number; y: number }
  >;
  useEffect(() => {
    if (!data) {
      setNodes([]);
      setEdges([]);
      return;
    }
    if ("startNodeId" in data) {
      setNodes(
        data.nodes.map((n, i) => ({
          id: n.nodeId,
          position: positions[n.nodeId] ?? { x: i * 240, y: (i % 2) * 120 },
          data: { label: `${n.kind.toUpperCase()}\n${n.levelId ?? n.nodeId}` },
          type:
            n.kind === "end"
              ? "output"
              : n.nodeId === data.startNodeId
                ? "input"
                : "default",
        })),
      );
      setEdges(
        data.edges.map((e) => ({
          id: e.edgeId,
          source: e.fromNodeId,
          target: e.toNodeId,
          label: e.selection,
        })),
      );
    } else {
      setNodes(
        data.nodes.map((n, i) => ({
          id: n.id,
          position: positions[n.id] ?? { x: i * 220, y: 80 + (i % 2) * 100 },
          data: {
            label: `${n.type.toUpperCase()}\n${n.action?.type ?? n.condition?.field ?? n.id}`,
          },
          type: n.type === "event" ? "input" : "default",
        })),
      );
      setEdges(
        data.edges.map((e, i) => ({
          id: `edge-${i}`,
          source: e.from,
          target: e.to,
        })),
      );
    }
  }, [data]);
  const connect = useCallback(
    (connection: Connection) => {
      if (!data || !selection) return;
      const next = structuredClone(data);
      if ("startNodeId" in next)
        next.edges.push({
          edgeId: `edge-${Date.now().toString(36)}`,
          fromNodeId: connection.source,
          toNodeId: connection.target,
          selection: "always",
          weight: 1,
        });
      else next.edges.push({ from: connection.source, to: connection.target });
      edit(selection.collection, data.id, next);
    },
    [data, selection],
  );
  const add = () => {
    if (!data || !selection) return;
    const next = structuredClone(data),
      id = `node-${Date.now().toString(36)}`;
    if ("startNodeId" in next)
      next.nodes.push({
        nodeId: id,
        kind: "level",
        levelId: draft!.content.levels.items[0].id,
        unlockRuleIds: [],
        difficultyScale: 1,
      });
    else {
      const node: Definition<"graphs">["nodes"][number] = {
        id,
        type: type as any,
      };
      if (type === "action") node.action = { type: "heal", amount: 10 };
      if (type === "condition")
        node.condition = { field: "amount", operator: "gte", value: 5 };
      if (type === "chance") node.probability = 0.5;
      if (type === "cooldown" || type === "delay") node.ticks = 30;
      next.nodes.push(node);
    }
    edit(selection.collection, data.id, next);
  };
  if (!data)
    return (
      <div className="empty">
        Выберите граф эффекта или кампанию в библиотеке.
        <br />
        Позиции узлов сохраняются отдельно от игровой логики.
      </div>
    );
  return (
    <div className="graph-studio">
      <div className="toolbar">
        <strong>{data.name}</strong>
        {!campaign && (
          <select
            aria-label="Тип узла"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {[
              "event",
              "condition",
              "chance",
              "cooldown",
              "delay",
              "action",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        )}
        <button onClick={add}>+ Узел</button>
        <span>Потяните соединитель между узлами</span>
      </div>
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={connect}
          fitView
          colorMode="dark"
          onNodeDragStop={(_, node) =>
            ui(`graph.${data.id}`, { ...positions, [node.id]: node.position })
          }
          onNodesDelete={(deleted) => {
            const ids = new Set(deleted.map((d) => d.id)),
              next = structuredClone(data);
            if ("startNodeId" in next) {
              next.nodes = next.nodes.filter((n) => !ids.has(n.nodeId));
              next.edges = next.edges.filter(
                (e) => !ids.has(e.fromNodeId) && !ids.has(e.toNodeId),
              );
            } else {
              next.nodes = next.nodes.filter((n) => !ids.has(n.id));
              next.edges = next.edges.filter(
                (e) => !ids.has(e.from) && !ids.has(e.to),
              );
            }
            edit(selection!.collection, data.id, next);
          }}
          onEdgesDelete={(deleted) => {
            const ids = new Set(deleted.map((d) => d.id)),
              next = structuredClone(data);
            if ("startNodeId" in next)
              next.edges = next.edges.filter((e) => !ids.has(e.edgeId));
            else
              next.edges = next.edges.filter((_, i) => !ids.has(`edge-${i}`));
            edit(selection!.collection, data.id, next);
          }}
        >
          <Background gap={24} size={1} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <p className="help">
        Выберите узел и нажмите Delete для удаления. Параметры узлов и переходов
        редактируются в инспекторе. Проверка обнаруживает циклы и недостижимые
        узлы.
      </p>
    </div>
  );
}
