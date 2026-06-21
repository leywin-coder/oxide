var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_child_process = require("child_process");
var import_vite = require("vite");
var import_openai = require("@ai-sdk/openai");
var import_google = require("@ai-sdk/google");

// src/server/agent.ts
var import_core = require("@openharness/core");
var import_ai = require("ai");
var import_zod = require("zod");
var WorkspaceFsProvider = class {
  constructor(files) {
    this.files = files;
  }
  readFile(path2) {
    const file = this.files.get(path2);
    if (!file) throw new Error(`File not found: ${path2}`);
    return Promise.resolve(file.content);
  }
  writeFile(path2, content) {
    const existing = this.files.get(path2);
    if (existing) {
      existing.content = content;
      existing.isDirty = true;
    } else {
      const name = path2.split("/").pop() || path2;
      this.files.set(path2, {
        path: path2,
        name,
        content,
        language: "typescript",
        isDirty: true,
        originalContent: content
      });
    }
    return Promise.resolve();
  }
  exists(path2) {
    return Promise.resolve(this.files.has(path2));
  }
  stat(path2) {
    const file = this.files.get(path2);
    if (file) {
      return Promise.resolve({ isFile: true, isDirectory: false, size: Buffer.byteLength(file.content) });
    }
    return Promise.resolve({ isFile: false, isDirectory: false, size: 0 });
  }
  readdir(path2) {
    const seen = /* @__PURE__ */ new Set();
    const entries = [];
    for (const file of this.files.values()) {
      if (file.path.startsWith(path2 + "/") || file.path === path2) {
        const relative = file.path.slice(path2.length + 1);
        if (!relative) continue;
        const first = relative.split("/")[0];
        if (!seen.has(first)) {
          seen.add(first);
          const isDirectory = file.path !== path2 + "/" + first && !file.path.startsWith(path2 + "/" + first + "/");
          entries.push({ name: first, isFile: !isDirectory, isDirectory });
        }
      }
    }
    return Promise.resolve(entries);
  }
  mkdir() {
    return Promise.resolve();
  }
  remove(path2) {
    this.files.delete(path2);
    return Promise.resolve();
  }
  rename(oldPath, newPath) {
    const file = this.files.get(oldPath);
    if (!file) throw new Error(`File not found: ${oldPath}`);
    const newName = newPath.split("/").pop() || newPath;
    file.path = newPath;
    file.name = newName;
    this.files.delete(oldPath);
    this.files.set(newPath, file);
    return Promise.resolve();
  }
  resolvePath(inputPath) {
    return inputPath.startsWith("/") ? inputPath : inputPath;
  }
};
var OXIDE_SYSTEM_PROMPT = `You are Oxide Agent, the ultra-fast AI assistant integrated within Oxide IDE (a lightweight high-performance developer sandbox). You operate inside a virtual workspace containing the user's project files. You have full access to tools that let you list, read, write, edit, and search files in the workspace. You can also manage todos, load skills, and delegate to subagents. Write optimized, production-ready code. Be highly precise. If requested, write complete files or clean git-style diffs. Explain instructions briefly.`;
async function buildOxideAgent(model, workspaceConfig) {
  const filesMap = /* @__PURE__ */ new Map();
  for (const file of workspaceConfig.files) {
    filesMap.set(file.path, file);
  }
  const fsProvider = new WorkspaceFsProvider(filesMap);
  const workspaceTools = createWorkspaceTools(fsProvider);
  let extraTools = {};
  if (workspaceConfig.todoStoreId !== false) {
    const { todowrite, todoread } = (0, import_core.createTodoTools)({ sessionId: workspaceConfig.todoStoreId ?? "oxide" });
    extraTools = { ...extraTools, todowrite, todoread };
  }
  if (workspaceConfig.skills) {
    const discovered = await (0, import_core.discoverSkills)(workspaceConfig.skills);
    if (discovered.length > 0) {
      extraTools = { ...extraTools, skill: (0, import_core.createSkillTool)(discovered) };
    }
  }
  const agent = new import_core.Agent({
    name: "oxide",
    description: "Ultra-fast AI assistant for the Oxide IDE virtual workspace",
    model,
    systemPrompt: OXIDE_SYSTEM_PROMPT,
    tools: { ...workspaceTools, ...extraTools },
    maxSteps: 20,
    mcpServers: workspaceConfig.mcpServers,
    subagents: workspaceConfig.subagents,
    maxSubagentDepth: 2,
    approve: workspaceConfig.approvalCallback,
    onSubagentEvent: (path2, event) => {
      console.log("[subagent]", path2.join("/"), event.type);
    }
  });
  return { agent, getFiles: () => Array.from(filesMap.values()) };
}
function createWorkspaceTools(fsProvider) {
  const readFile = (0, import_ai.tool)({
    description: "Read the contents of a virtual workspace file by path.",
    inputSchema: import_zod.z.object({
      path: import_zod.z.string().describe("Workspace file path")
    }),
    execute: async ({ path: path2 }) => {
      try {
        const content = await fsProvider.readFile(path2);
        return { path: path2, content };
      } catch (err) {
        return { error: err.message, path: path2 };
      }
    }
  });
  const writeFile = (0, import_ai.tool)({
    description: "Create or overwrite a virtual workspace file with the provided content.",
    inputSchema: import_zod.z.object({
      path: import_zod.z.string().describe("Workspace file path"),
      content: import_zod.z.string().describe("Full file content")
    }),
    execute: async ({ path: path2, content }) => {
      await fsProvider.writeFile(path2, content);
      return { path: path2, written: true };
    }
  });
  const editFile = (0, import_ai.tool)({
    description: "Edit a virtual workspace file by replacing an exact string match.",
    inputSchema: import_zod.z.object({
      path: import_zod.z.string(),
      oldString: import_zod.z.string(),
      newString: import_zod.z.string(),
      replaceAll: import_zod.z.boolean().optional().default(false)
    }),
    execute: async ({ path: path2, oldString, newString, replaceAll }) => {
      const content = await fsProvider.readFile(path2);
      if (!content.includes(oldString)) {
        return { error: "oldString not found in file", path: path2 };
      }
      const updated = replaceAll ? content.replaceAll(oldString, newString) : content.replace(oldString, newString);
      await fsProvider.writeFile(path2, updated);
      return { path: path2, replacements: replaceAll ? content.split(oldString).length - 1 : 1 };
    }
  });
  const listFiles = (0, import_ai.tool)({
    description: "List all virtual workspace files along with their paths and names.",
    inputSchema: import_zod.z.object({}),
    execute: async () => {
      const files = await fsProvider.readdir("");
      return { files: files.map((f) => ({ path: f.name, name: f.name })) };
    }
  });
  const deleteFile = (0, import_ai.tool)({
    description: "Delete a virtual workspace file.",
    inputSchema: import_zod.z.object({
      path: import_zod.z.string()
    }),
    execute: async ({ path: path2 }) => {
      await fsProvider.remove(path2);
      return { deleted: path2 };
    }
  });
  const renameFile = (0, import_ai.tool)({
    description: "Rename a virtual workspace file.",
    inputSchema: import_zod.z.object({
      oldPath: import_zod.z.string(),
      newPath: import_zod.z.string()
    }),
    execute: async ({ oldPath, newPath }) => {
      await fsProvider.rename(oldPath, newPath);
      return { renamed: newPath };
    }
  });
  return { readFile, writeFile, editFile, listFiles, deleteFile, renameFile };
}

// server.ts
var import_dotenv = __toESM(require("dotenv"), 1);
var pty = __toESM(require("node-pty"), 1);
var import_ws = require("ws");
var import_http = __toESM(require("http"), 1);
var import_ai2 = require("ai");
var import_core2 = require("@openharness/core");
var import_core3 = require("@openharness/core");
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = 3e3;
app.use(import_express.default.json());
app.post("/api/compiler/compile", async (req, res) => {
  try {
    const { files, command } = req.body;
    if (!files || !Array.isArray(files)) {
      res.status(400).json({ error: "Files array is required" });
      return;
    }
    const enginePath = import_path.default.join(process.cwd(), "oxide-engine", "target", "release", "oxide-engine");
    const binary = import_fs.default.existsSync(enginePath) ? enginePath : "cargo";
    const spawnArgs = binary === "cargo" ? ["run", "--release", "--quiet"] : [];
    const cwd = binary === "cargo" ? import_path.default.join(process.cwd(), "oxide-engine") : process.cwd();
    const child = (0, import_child_process.spawn)(binary, spawnArgs, {
      cwd,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.stdin.write(JSON.stringify({ files, command: command || "" }));
    child.stdin.end();
    const code = await new Promise((resolve) => {
      child.on("close", (c) => resolve(c ?? 1));
      child.on("error", () => resolve(1));
    });
    if (code !== 0 || stdout.trim() === "") {
      res.status(500).json({
        error: stderr || "oxide-engine failed to produce output",
        stdout,
        stderr,
        exitCode: code,
        success: false
      });
      return;
    }
    try {
      const report = JSON.parse(stdout);
      res.json(report);
    } catch (parseErr) {
      res.status(500).json({
        error: "Failed to parse oxide-engine output",
        raw: stdout,
        stderr
      });
    }
  } catch (error) {
    console.error("Compile error:", error);
    res.status(500).json({ error: error.message || "Compiler backend failure" });
  }
});
function resolveModel(customConfig) {
  const provider = customConfig?.provider || "gemini-api";
  if (provider === "openai-compatible") {
    const baseUrl = customConfig?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const apiKey2 = customConfig?.apiKey || process.env.OPENAI_API_KEY || "";
    const model2 = customConfig?.model || "gpt-4o-mini";
    return (0, import_openai.createOpenAI)({ baseURL: baseUrl, apiKey: apiKey2 }).chat(model2);
  }
  const apiKey = customConfig?.geminiApiKey || process.env.GEMINI_API_KEY || "dummy_key";
  const baseURL = customConfig?.geminiBaseUrl || process.env.GEMINI_BASE_URL;
  const model = customConfig?.geminiModel || "gemini-3.5-flash";
  return (0, import_google.createGoogleGenerativeAI)({ apiKey, baseURL }).chat(model);
}
function toModelMessages(messages) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content };
    }
    return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
  });
}
app.post("/api/agent/chat", async (req, res) => {
  try {
    const { messages, customConfig, previousInteractionId, files, mcpServers, skills, subagents } = req.body;
    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: "Messages array is required" });
      return;
    }
    const model = resolveModel(customConfig);
    const workspaceConfig = {
      files: files || [],
      mcpServers: mcpServers || {},
      skills: skills || void 0,
      subagents: subagents || void 0,
      todoStoreId: previousInteractionId || "oxide"
    };
    const { agent, getFiles } = await buildOxideAgent(model, workspaceConfig);
    const session = new import_core3.Session({
      agent,
      sessionId: previousInteractionId || `oxide-${Date.now()}`,
      contextWindow: 128e3
    });
    const modelMessages = toModelMessages(messages);
    const userPrompt = messages[messages.length - 1]?.content || "";
    const response = (0, import_ai2.createUIMessageStreamResponse)({
      stream: (0, import_core2.sessionEventsToUIStream)(session.send(userPrompt, { signal: req.signal }), { signal: req.signal }),
      headers: {
        "X-Session-Id": session.sessionId,
        "X-OpenHarness-Version": "0.7.0"
      }
    });
    res.on("close", async () => {
      await agent.close();
    });
    response.body?.pipeTo(
      new WritableStream({
        write(chunk) {
          if (!res.writableEnded) res.write(chunk);
        },
        close() {
          if (!res.writableEnded) {
            res.setHeader("X-Workspace-Files", JSON.stringify(getFiles()));
            res.end();
          }
        },
        abort() {
          if (!res.writableEnded) res.end();
        }
      })
    );
  } catch (error) {
    console.error("Agent chat error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});
app.post("/api/terminal/exec", async (req, res) => {
  try {
    const { command, cwd } = req.body;
    if (!command || typeof command !== "string") {
      res.status(400).json({ error: "command is required" });
      return;
    }
    const workingDir = cwd && typeof cwd === "string" ? import_path.default.resolve(cwd) : process.cwd();
    if (!import_fs.default.existsSync(workingDir)) {
      res.status(400).json({ error: "cwd does not exist" });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.status(200);
    const child = (0, import_child_process.spawn)(command, { shell: true, cwd: workingDir, env: process.env });
    const send = (obj) => {
      if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
    };
    const buffers = { stdout: "", stderr: "" };
    const flush = (stream) => {
      const parts = buffers[stream].split("\n");
      buffers[stream] = parts.pop() || "";
      for (const line of parts) {
        send({ type: stream, data: line });
      }
    };
    child.stdout.on("data", (data) => {
      buffers.stdout += data.toString();
      flush("stdout");
    });
    child.stderr.on("data", (data) => {
      buffers.stderr += data.toString();
      flush("stderr");
    });
    child.on("close", (code) => {
      flush("stdout");
      flush("stderr");
      send({ type: "exit", code: code ?? 0 });
      if (!res.writableEnded) res.end();
    });
    child.on("error", (err) => {
      send({ type: "error", message: err.message });
      send({ type: "exit", code: 1 });
      if (!res.writableEnded) res.end();
    });
    req.on("close", () => {
      if (!child.killed) child.kill();
    });
  } catch (error) {
    console.error("Terminal exec error:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  const server = import_http.default.createServer(app);
  const wss = new import_ws.WebSocketServer({ server, path: "/api/terminal/ws" });
  const terminals = /* @__PURE__ */ new Map();
  const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash";
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session") || `tty-${Date.now()}`;
    let term = terminals.get(sessionId);
    if (!term) {
      term = pty.spawn(shell, [], {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env
      });
      terminals.set(sessionId, term);
    }
    ws.on("message", (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "input" && typeof data.payload === "string") {
          term.write(data.payload);
        } else if (data.type === "resize" && typeof data.cols === "number" && typeof data.rows === "number") {
          term.resize(data.cols, data.rows);
        }
      } catch {
        term.write(message.toString());
      }
    });
    term.onData((data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "output", payload: data }));
    });
    term.onExit(({ exitCode }) => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ type: "exit", exitCode }));
      ws.close();
    });
    ws.on("close", () => {
    });
    ws.send(JSON.stringify({ type: "ready", sessionId }));
  });
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
