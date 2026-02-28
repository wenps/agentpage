import { WebAgent } from "../src/web/index.js";
import type { ToolCallResult } from "../src/core/tool-registry.js";

type RepoVisibility = "private" | "internal" | "public";

type RepoItem = {
  id: string;
  name: string;
  path: string;
  owner: string;
  visibility: RepoVisibility;
  template: string;
  readme: boolean;
};

const statusEl = document.getElementById("status") as HTMLSpanElement;
const tokenEl = document.getElementById("token") as HTMLInputElement;
const modelEl = document.getElementById("model") as HTMLSelectElement;
const streamModeEl = document.getElementById("streamMode") as HTMLSelectElement;
const dryrunEl = document.getElementById("dryrun") as HTMLInputElement;
const memoryEl = document.getElementById("memory") as HTMLInputElement;

const chatEl = document.getElementById("chat") as HTMLDivElement;
const inputEl = document.getElementById("input") as HTMLInputElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;
const chatDockToggle = document.getElementById("chatDockToggle") as HTMLDivElement;

const repoSearchEl = document.getElementById("repoSearch") as HTMLInputElement;
const repoNameEl = document.getElementById("repoName") as HTMLInputElement;
const repoPathEl = document.getElementById("repoPath") as HTMLInputElement;
const repoDescEl = document.getElementById("repoDesc") as HTMLTextAreaElement;
const repoOwnerEl = document.getElementById("repoOwner") as HTMLSelectElement;
const repoReadmeEl = document.getElementById("repoReadme") as HTMLInputElement;
const formMessageEl = document.getElementById("formMessage") as HTMLSpanElement;
const createRepoBtn = document.getElementById("createRepoBtn") as HTMLButtonElement;

const tagDropdownTrigger = document.getElementById("tagDropdownTrigger") as HTMLButtonElement;
const tagDropdownMenu = document.getElementById("tagDropdownMenu") as HTMLDivElement;
const selectedTagEl = document.getElementById("selectedTag") as HTMLSpanElement;

const repoTableBodyEl = document.getElementById("repoTableBody") as HTMLTableSectionElement;
const toastEl = document.getElementById("toast") as HTMLDivElement;

const openCreateModalBtn = document.getElementById("openCreateModal") as HTMLButtonElement;
const createModalMaskEl = document.getElementById("createModalMask") as HTMLDivElement;
const modalSummaryEl = document.getElementById("modalSummary") as HTMLParagraphElement;
const cancelCreateModalBtn = document.getElementById("cancelCreateModal") as HTMLButtonElement;
const confirmCreateModalBtn = document.getElementById("confirmCreateModal") as HTMLButtonElement;

let selectedTemplate = "Node";
let dockExpanded = true;
let repos: RepoItem[] = [
  {
    id: "r-1",
    name: "repo-search-service",
    path: "backend/repo-search-service",
    owner: "backend",
    visibility: "internal",
    template: "Node",
    readme: true,
  },
  {
    id: "r-2",
    name: "repo-ui-studio",
    path: "frontend/repo-ui-studio",
    owner: "frontend",
    visibility: "private",
    template: "React",
    readme: false,
  },
];

const agent = new WebAgent({
  token: import.meta.env.DEEPSEEK_TOKEN ?? "",
  provider: "deepseek",
  model: "deepseek-chat",
  baseURL: "/api",
  stream: true,
});
agent.registerTools();

agent.callbacks = {
  onRound: (round) => {
    statusEl.textContent = `系统思考中 (第 ${round + 1} 轮)...`;
  },
  onText: (text) => appendMsg("assistant", text),
  onToolCall: (name, input) => appendMsg("tool-call", `${name}(${JSON.stringify(input)})`),
  onToolResult: (_name, result: ToolCallResult) => {
    const content = typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content, null, 2);
    appendMsg("tool-result", content);
  },
  onMetrics: (metrics) => {
    appendMsg("system", `📊 ${JSON.stringify(metrics)}`);
  },
};

initialize();

function initialize(): void {
  const savedToken = localStorage.getItem("ap_token");
  if (savedToken) {
    tokenEl.value = savedToken;
    statusEl.textContent = "已连接";
  }

  sendBtn.addEventListener("click", () => {
    void handleSend();
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  });

  tokenEl.addEventListener("change", () => {
    if (tokenEl.value.trim()) {
      localStorage.setItem("ap_token", tokenEl.value.trim());
      statusEl.textContent = "已连接";
    }
  });

  memoryEl.addEventListener("change", () => {
    agent.setMemory(memoryEl.checked);
    if (!memoryEl.checked) {
      agent.clearHistory();
    }
    appendMsg("system", memoryEl.checked ? "🧠 记忆已开启" : "🧠 记忆已关闭并清空");
  });

  chatDockToggle.addEventListener("click", () => {
    dockExpanded = !dockExpanded;
    chatEl.style.display = dockExpanded ? "" : "none";
    chatDockToggle.textContent = dockExpanded ? "▲ 聊天面板 ▲" : "▼ 聊天面板 ▼";
  });

  repoNameEl.addEventListener("input", syncCreateButton);
  repoSearchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderRepoTable();
    }
  });

  tagDropdownTrigger.addEventListener("click", () => {
    tagDropdownMenu.classList.toggle("open");
  });

  tagDropdownMenu.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const option = target.closest("[data-value]") as HTMLElement | null;
    if (!option) return;
    selectedTemplate = option.dataset.value ?? "Node";
    selectedTagEl.textContent = selectedTemplate;
    tagDropdownMenu.classList.remove("open");
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (!tagDropdownMenu.contains(target) && !tagDropdownTrigger.contains(target)) {
      tagDropdownMenu.classList.remove("open");
    }
  });

  createRepoBtn.addEventListener("click", () => {
    createRepo();
  });

  repoTableBodyEl.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const removeId = target.getAttribute("data-remove-id");
    if (!removeId) return;
    repos = repos.filter(repo => repo.id !== removeId);
    renderRepoTable();
  });

  openCreateModalBtn.addEventListener("click", openCreateModal);
  cancelCreateModalBtn.addEventListener("click", closeCreateModal);
  confirmCreateModalBtn.addEventListener("click", () => {
    closeCreateModal();
    createRepo();
  });
  createModalMaskEl.addEventListener("click", (event) => {
    if (event.target === createModalMaskEl) closeCreateModal();
  });

  renderRepoTable();
  syncCreateButton();

  appendMsg("system", `✅ 已注册工具：${agent.getTools().map(t => t.name).join(", ")}`);
}

function getCurrentVisibility(): RepoVisibility {
  const selected = document.querySelector('input[name="visibility"]:checked') as HTMLInputElement | null;
  const value = selected?.value;
  if (value === "public" || value === "internal") return value;
  return "private";
}

function syncCreateButton(): void {
  const enabled = repoNameEl.value.trim().length > 0;
  createRepoBtn.disabled = !enabled;
  formMessageEl.textContent = enabled ? "可以创建仓库。" : "请先填写仓库名称。";
}

function openCreateModal(): void {
  const previewName = repoNameEl.value.trim() || "(未填写)";
  const previewPath = repoPathEl.value.trim() || "(未填写)";
  modalSummaryEl.textContent = `名称：${previewName} | 路径：${previewPath} | Owner：${repoOwnerEl.value} | 可见性：${getCurrentVisibility()} | 模板：${selectedTemplate}`;
  createModalMaskEl.style.display = "flex";
}

function closeCreateModal(): void {
  createModalMaskEl.style.display = "none";
}

function createRepo(): void {
  const name = repoNameEl.value.trim();
  if (!name) {
    formMessageEl.textContent = "仓库名称不能为空。";
    return;
  }

  const next: RepoItem = {
    id: `r-${Date.now()}`,
    name,
    path: repoPathEl.value.trim() || `${repoOwnerEl.value}/${name}`,
    owner: repoOwnerEl.value,
    visibility: getCurrentVisibility(),
    template: selectedTemplate,
    readme: repoReadmeEl.checked,
  };

  repos = [next, ...repos];
  renderRepoTable();

  repoNameEl.value = "";
  repoPathEl.value = "";
  repoDescEl.value = "";
  repoReadmeEl.checked = false;
  selectedTemplate = "Node";
  selectedTagEl.textContent = selectedTemplate;
  syncCreateButton();

  formMessageEl.textContent = `已创建仓库：${next.name}`;
  toastEl.textContent = `✅ 创建成功：${next.name}`;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), 1200);
}

function renderRepoTable(): void {
  const keyword = repoSearchEl.value.trim().toLowerCase();
  const filtered = repos.filter((repo) => {
    if (!keyword) return true;
    return repo.name.toLowerCase().includes(keyword) || repo.path.toLowerCase().includes(keyword);
  });

  if (filtered.length === 0) {
    repoTableBodyEl.innerHTML = '<tr><td colspan="6">无匹配仓库</td></tr>';
    return;
  }

  repoTableBodyEl.innerHTML = filtered
    .map(repo => `
      <tr>
        <td>${repo.name}</td>
        <td>${repo.path}</td>
        <td>${repo.owner}</td>
        <td>${repo.visibility}</td>
        <td>${repo.template}${repo.readme ? " + README" : ""}</td>
        <td><button data-remove-id="${repo.id}">删除</button></td>
      </tr>
    `)
    .join("");
}

async function handleSend(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text) return;

  const token = tokenEl.value.trim();
  if (!token) {
    appendMsg("error", "请先填写 Token");
    return;
  }

  inputEl.value = "";
  appendMsg("user", text);

  agent.setToken(token);
  agent.setModel(modelEl.value);
  agent.setStream(streamModeEl.value === "stream");
  agent.setDryRun(dryrunEl.checked);

  try {
    await agent.chat(text);
  } catch (error) {
    appendMsg("error", `执行失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    statusEl.textContent = "已连接";
    inputEl.focus();
  }
}

function appendMsg(type: string, text: string): void {
  const div = document.createElement("div");
  div.className = `msg ${type}`;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function sendQuick(text: string): void {
  inputEl.value = text;
  void handleSend();
}

function clearHistory(): void {
  agent.clearHistory();
  appendMsg("system", "已清空历史");
}

(window as Window & { sendQuick: (text: string) => void; clearHistory: () => void }).sendQuick = sendQuick;
(window as Window & { sendQuick: (text: string) => void; clearHistory: () => void }).clearHistory = clearHistory;
