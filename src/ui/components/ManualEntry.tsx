import { addOrUpdateActivity } from "@/core/dataQueries";
import { Notice, TFile } from "obsidian";
import { AbstractInputSuggest } from "obsidian";
import { App, Modal, Setting, TextComponent } from "obsidian";
import {
	getFileNameWithoutExtension,
} from "@/utils/utils";
import { getToday } from "@/utils/dateUtils";

export class ManualEntryModal extends Modal {
	private thisDate: string;
	private filePath: string;
	private wordAdded: number;

	constructor(app: App) {
		super(app);
		
		this.thisDate = getToday();
		this.filePath = "";
		this.wordAdded = 0;

		this.setTitle("Add or Update entry:");

		new Setting(this.contentEl)
			.setName("File")
			.setClass("ktr-no-border")
			.addSearch((search) => {
				search
					.setPlaceholder("Example: folder1/folder2")
					.setValue("")
					.onChange(async (value) => {
						this.filePath = value;
					});

				new FileSuggest(this.app, search.inputEl);

				search.inputEl.addEventListener("blur", async () => {
					this.filePath = search.getValue();
				});
			});

		new Setting(this.contentEl)
			.setClass("ktr-no-border")
			.setName("Word Added")
			.addText((text) => {
				text.onChange((value) => {
					this.wordAdded = Number(value);
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
					.setValue(this.thisDate)
					.onChange((value) => {
						this.thisDate = value;
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
				hiddenDateInput.value = getToday();

				hiddenDateInput.addEventListener("change", () => {
					const picked = window.moment(
						hiddenDateInput.value,
						"YYYY-MM-DD",
					);
					if (picked.isValid()) {
						const formatted = picked.format("YYYY-MM-DD");
						momentTextComponent.setValue(formatted);
						this.thisDate = formatted;
					}
				});
			});

		new Setting(this.contentEl).addButton((btn) =>
			btn
				.setButtonText("Save Entry")
				.setCta()
				.onClick(() => {
					this.saveNewEntry();
					this.close();
				}),
		);
	}

	private async saveNewEntry() {
		if (this.wordAdded <= 0) {
			new Notice("Please enter a valid word added");
			return;
		}
		if (this.thisDate > getToday()) {
			new Notice("Date must be before today");
			return;
		}
		const file = this.app.vault.getFileByPath(this.filePath);
		if (!file) {
			new Notice(`File not found: ${this.filePath}`);
			return;
		}
		await addOrUpdateActivity(file, this.thisDate, this.wordAdded);
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
		const queryLower = query.toLowerCase();
		return this.app.vault
			.getMarkdownFiles()
			.reduce<TFile[]>((acc, file) => {
				if (acc.length >= 20) return acc;
				if (file.path.toLowerCase().includes(queryLower)) {
					acc.push(file);
				}
				return acc;
			}, []);
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		el.setText(file.path);
	}

	selectSuggestion(file: TFile) {
		this.inputEl.value = file.path;
		this.inputEl.trigger("input");
		this.close();
	}
}
