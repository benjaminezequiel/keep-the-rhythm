import { Modal } from "obsidian";
import { Setting } from "obsidian";
import { App } from "obsidian";

export class ConfirmationModal extends Modal {
  private onConfirm: () => void;
  private onCancel: () => void;
  private message: string;
  private confirmText: string;

  constructor(
    app: App,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
    confirmText = "Confirm",
  ) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel || (() => {});
    this.confirmText = confirmText;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    //TODO

    contentEl.createEl("h3", { text: "Confirm action" });
    contentEl.createEl("p", { text: this.message });

    new Setting(contentEl)
      .addButton((button) =>
        button.setButtonText("Cancel").onClick(() => {
          this.onCancel();
          this.close();
        }),
      )
      .addButton((button) =>
        button
          .setButtonText(this.confirmText)
          .setCta()
          .onClick(() => {
            this.onConfirm();
            this.close();
          }),
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
