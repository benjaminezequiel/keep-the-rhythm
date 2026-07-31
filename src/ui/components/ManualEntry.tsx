import { addDeltaToActivity } from "@/core/dataQueries";
import { TFile } from "obsidian";
import { useStore } from "@/core/store";
import { AbstractInputSuggest } from "obsidian";
import { App, Modal, Setting, TextComponent } from "obsidian";
import {
	getExistingOrCreateNewEntry,
	getFileNameWithoutExtension,
} from "@/utils/utils";
import { DailyActivity } from "@/defs/types";

export class ManualEntryModal extends Modal {
	private entry: DailyActivity;

	private wordsDelta = 0;

	constructor(app: App) {
		super(app);
		// Read today / currentActivity once, at modal-open time.  The modal
		// is short-lived so a snapshot is fine — no need for reactive
		// subscriptions here.
		const store = useStore.getState();
		this.entry = {
			date: store.today,
			filePath: "",
			wordCountStart: 0,
			wordsAdded: 0,
		};
		this.setTitle("Add a new entry:");

		new Setting(this.contentEl)
			.setName("File")
			.setClass("ktr-no-border")
			.addSearch((search) => {
				search
					.setPlaceholder("Example: folder1/folder2")
					.setValue(store.currentActivity?.filePath || "")
					.onChange(async (value) => {
						this.entry.filePath = value;
					});

				new FileSuggest(this.app, search.inputEl);

				search.inputEl.addEventListener("blur", async () => {
					const value = search.getValue();
					const file = this.app.vault.getFileByPath(value);

					if (!file) {
						console.error("KTR: Invalid file selection");
						return;
					}
					this.entry = await getExistingOrCreateNewEntry(
						file,
						useStore.getState().today,
					);
				});
			});

		new Setting(this.contentEl)
			.setClass("ktr-no-border")
			.setName("Word Count")
			.addText((text) => {
				text.onChange((value) => {
					this.wordsDelta = Number(value);
				});
			});

		let momentTextComponent: TextComponent;
		let hiddenDateInput: HTMLInputElement;

		new Setting(this.contentEl)
			.setClass("ktr-no-border")
			.setName("Date")
			.addText((text) => {
				momentTextComponent = text;
				text.setPlaceholder("YYYY-MM-DD")
					.setValue(store.today)
					.onChange((value) => {
						this.entry.date = value;
						const m = window.moment(value, "YYYY-MM-DD", true);
						if (m.isValid() && hiddenDateInput)
							hiddenDateInput.value = m.format("YYYY-MM-DD");
					});
			})
			.addButton((btn) => {
				btn.setIcon("calendar")
					.setTooltip("Pick a date")
					.onClick(() => hiddenDateInput.showPicker())
					.setClass("ktr-date-button");

				hiddenDateInput = btn.buttonEl.createEl("input");
				hiddenDateInput.type = "date";
				hiddenDateInput.addClass("ktr-hidden-date-input");
				hiddenDateInput.value = window
					.moment(store.today, "YYYY-MM-DD")
					.format("YYYY-MM-DD");

				hiddenDateInput.addEventListener("change", () => {
					const picked = window.moment(
						hiddenDateInput.value,
						"YYYY-MM-DD",
					);
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
					// Persist is handled inside addDeltaToActivity (data
					// layer) — UI layers must not request persist directly.
					this.close();
				}),
		);
	}

	private async saveNewEntry() {
		await addDeltaToActivity(this.entry, this.wordsDelta);
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
			.filter((file) =>
				file.path.toLowerCase().includes(query.toLowerCase()),
			);
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
