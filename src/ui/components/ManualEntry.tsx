import { addDeltaToActivity } from "@/db/queries";
import { TFile } from "obsidian";
import { EVENTS, state } from "@/core/pluginState";
import { AbstractInputSuggest } from "obsidian";
import { App, Modal, Setting, TextComponent } from "obsidian";
import {
  getExistingOrCreateNewEntry,
  getFileNameWithoutExtension,
} from "@/utils/utils";
import { DailyActivity } from "@/db/types";

export class ManualEntryModal extends Modal {
  private entry: DailyActivity = {
    date: state.today,
    filePath: "",
    wordCountStart: 0,
    charCountStart: 0,
    changes: [],
  };

  private wordsDelta = 0;
  private charsDelta = 0;
  private charsManuallySet = false;
  private charsInput: TextComponent;

  constructor(app: App) {
    super(app);
    this.setTitle("Add a new entry:");

    new Setting(this.contentEl)
      .setName("File")
      .setClass("ktr-no-border")
      .addSearch((search) => {
        search
          .setPlaceholder("Example: folder1/folder2")
          .setValue(state.currentActivity?.filePath || "")
          .onChange(async (value) => {
            this.entry.filePath = value;
          });

        new FileSuggest(this.app, search.inputEl);

        search.inputEl.addEventListener("blur", async () => {
          const value = search.getValue();
          const file = state.plugin.app.vault.getFileByPath(value);

          if (!file) {
            console.log("invalid file selection");
            return;
          }
          this.entry = await getExistingOrCreateNewEntry(file, state.today);
        });
      });

    new Setting(this.contentEl)
      .setClass("ktr-no-border")
      .setName("Word Count")
      .addText((text) => {
        text.onChange((value) => {
          this.wordsDelta = Number(value);

          if (!this.charsManuallySet) {
            const derived = this.wordsDelta * 5;
            this.charsDelta = derived;
            this.charsInput.setValue(derived === 0 ? "" : String(derived));
          }
        });
      });

    new Setting(this.contentEl)
      .setName("Character Count")
      .setClass("ktr-no-border")
      .setDesc("Defaults to words × 5. Edit to override.")
      .addText((text) => {
        this.charsInput = text;
        text.setPlaceholder("Auto").onChange((value) => {
          if (value === "") {
            this.charsManuallySet = false;
            this.charsDelta = this.wordsDelta * 5;
          } else {
            this.charsManuallySet = true;
            this.charsDelta = Number(value);
          }
        });
      });

    let momentTextComponent: TextComponent;
    let hiddenDateInput: HTMLInputElement;

    new Setting(this.contentEl)
      .setClass("ktr-no-border")
      .setName("Date")
      .addText((text) => {
        momentTextComponent = text;
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(state.today)
          .onChange((value) => {
            this.entry.date = value;
            const m = window.moment(value, "YYYY-MM-DD", true);
            if (m.isValid() && hiddenDateInput)
              hiddenDateInput.value = m.format("YYYY-MM-DD");
          });
      })
      .addButton((btn) => {
        btn
          .setIcon("calendar")
          .setTooltip("Pick a date")
          .onClick(() => hiddenDateInput.showPicker())
          .setClass("ktr-date-button");

        hiddenDateInput = btn.buttonEl.createEl("input");
        hiddenDateInput.type = "date";
        hiddenDateInput.addClass("ktr-hidden-date-input");
        hiddenDateInput.value = window
          .moment(state.today, "YYYY-MM-DD")
          .format("YYYY-MM-DD");

        hiddenDateInput.addEventListener("change", () => {
          const picked = window.moment(hiddenDateInput.value, "YYYY-MM-DD");
          if (picked.isValid()) {
            const formatted = picked.format("YYYY-MM-DD");
            momentTextComponent.setValue(formatted);
            this.entry.date = formatted;
          }
        });
      });

    new Setting(this.contentEl).addButton((btn) =>
      btn
        .setButtonText("Save New Entry")
        .setCta()
        .onClick(() => {
          this.saveNewEntry();
          state.emit(EVENTS.REFRESH_EVERYTHING);
          this.close();
        }),
    );
  }

  private validate() {
    console.log("not valid");
  }

  private async saveNewEntry() {
    await addDeltaToActivity(this.entry, this.wordsDelta, this.charsDelta);
  }
}

export class FileSuggest extends AbstractInputSuggest<TFile> {
  app: App;
  inputEl: HTMLInputElement;

  constructor(app: App, inputEl: HTMLInputElement) {
    super(app, inputEl);
    this.app = app;
    this.inputEl = inputEl;
  }

  getSuggestions(query: string): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.toLowerCase().includes(query.toLowerCase()));
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.setText(getFileNameWithoutExtension(file.name));
  }

  selectSuggestion(file: TFile) {
    this.inputEl.value = file.path;
    this.inputEl.trigger("input");
    this.close();
  }
}
