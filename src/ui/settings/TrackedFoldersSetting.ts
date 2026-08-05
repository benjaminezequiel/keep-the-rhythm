import { Notice, Setting, TextComponent, Modal, TFolder, AbstractInputSuggest, App } from "obsidian";
import { SettingItem } from "./SettingSchema";
import { getPlugin } from "@/core/pluginRegistry";
import { useStore } from "@/core/store";

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  app: App;
  inputEl: HTMLInputElement;
  private allFolders: TFolder[] = [];

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.app = app;
    this.inputEl = inputEl;
    this.refreshFolders();
  }

  private refreshFolders() {
    this.allFolders = this.app.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder);
  }

  getSuggestions(query: string): TFolder[] {
    if (!query) return this.allFolders.slice(0, 20);
    const lower = query.toLowerCase();
    return this.allFolders
      .filter((folder) => folder.path.toLowerCase().includes(lower))
      .slice(0, 20);
  }

  renderSuggestion(folder: TFolder, el: HTMLElement) {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder) {
    this.inputEl.value = folder.path;
    this.inputEl.trigger("input");
    this.close();
  }
}

export class TrackedFoldersModal extends Modal {
  private onChanged: () => void;

  constructor(app: App, onChanged: () => void) {
    super(app);
    this.onChanged = onChanged;
    this.setTitle("Tracked Folders");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("p", {
      text: "Only files under these folders will be tracked. Leave empty to track the whole vault.",
      cls: "ktr-tracked-folders-desc",
    });

    this.renderFolderList(contentEl);

    contentEl.createEl("div", { cls: "ktr-tracked-folders-divider" });

    const inputRow = contentEl.createDiv({
      cls: "ktr-tracked-folders-input-row",
    });

    let textComponent: TextComponent;

    const textWrapper = inputRow.createDiv({
      cls: "ktr-tracked-folders-text-wrapper",
    });

    textComponent = new TextComponent(textWrapper);
    textComponent.setPlaceholder("Enter folder path...");

    new FolderSuggest(this.app, textComponent.inputEl);

    const addBtn = inputRow.createEl("button", {
      text: "Add",
      cls: "ktr-tracked-folders-add-btn",
    });
    addBtn.type = "button";

    const handleAdd = () => {
      const raw = textComponent.getValue();
      const normalized = raw.trim().replace(/^\/+|\/+$/g, "");
      if (!normalized) return;

      const folders = useStore.getState().settings.trackedFolders || [];
      if (folders.includes(normalized)) {
        new Notice("This folder is already in the tracking scope.");
        return;
      }

      useStore.getState().mutateSettings((draft) => {
        draft.trackedFolders = [...folders, normalized];
      });
      textComponent.setValue("");
      this.onChanged();
      this.renderFolderList(contentEl);
    };

    addBtn.addEventListener("click", () => handleAdd());

    textComponent.inputEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        handleAdd();
      }
    });
  }

  private renderFolderList(contentEl: HTMLElement) {
    const { contentEl: ce } = this;
    const divider = ce.querySelector(".ktr-tracked-folders-divider");
    if (divider) {
      let node = divider.previousElementSibling;
      while (node && !node.classList.contains("ktr-tracked-folders-desc")) {
        const prev = node.previousElementSibling;
        node.remove();
        node = prev;
      }
    }

    const settings = useStore.getState().settings;
    const folders = settings.trackedFolders || [];

    const listContainer = ce.createDiv({
      cls: "ktr-tracked-folders-list-items",
    });

    if (folders.length === 0) {
      listContainer.createEl("div", {
        text: "No folders configured — tracking the whole vault.",
        cls: "ktr-tracked-folders-empty",
      });
      return;
    }

    folders.forEach((folder) => {
      const row = listContainer.createDiv({
        cls: "ktr-tracked-folders-item",
      });

      row.createEl("span", {
        text: folder,
        cls: "ktr-tracked-folders-path",
      });

      const deleteBtn = row.createEl("button", {
        cls: "ktr-tracked-folders-delete-btn",
      });
      deleteBtn.type = "button";

      const deleteIcon = document.createElement("span");
      deleteIcon.textContent = "✕";
      deleteBtn.appendChild(deleteIcon);

      deleteBtn.addEventListener("click", () => {
        const currentFolders = useStore.getState().settings.trackedFolders || [];
        useStore.getState().mutateSettings((draft) => {
          draft.trackedFolders = currentFolders.filter((f) => f !== folder);
        });
        this.onChanged();
        this.renderFolderList(contentEl);
      });
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export function createTrackedFoldersSetting(
  setting: Setting,
  _config: SettingItem,
): void {
  const listContainer = setting.infoEl.createDiv({
    cls: "ktr-tracked-folders-list",
  });

  setting.addButton((btn) => {
    btn.setButtonText("Manage").setTooltip("Manage tracked folders").onClick(() => {
      const modal = new TrackedFoldersModal(getPlugin().app, () => {
        renderList();
      });
      modal.open();
    });
  });

  function renderList() {
    listContainer.empty();
    const folders = useStore.getState().settings.trackedFolders || [];

    if (folders.length === 0) {
      listContainer.createEl("div", {
        text: "No folders configured — tracking the whole vault.",
        cls: "ktr-tracked-folders-empty",
      });
      return;
    }

    const ul = listContainer.createEl("ul", {
      cls: "ktr-tracked-folders-bullet-list",
    });

    folders.forEach((folder) => {
      ul.createEl("li", { text: `${folder}/` });
    });
  }

  renderList();
}