import { TAbstractFile, TFile, App, Modal, Setting, FuzzySuggestModal, TFolder } from 'obsidian';

import MathBooster from './main';
import { MathSettings, MathContextSettings, DEFAULT_SETTINGS } from './settings/settings';
import { MathSettingTab } from "./settings/tab";
import { TheoremCalloutSettingsHelper, MathContextSettingsHelper, ProjectSettingsHelper } from "./settings/helper";
import { isEqualToOrChildOf, isPluginOlderThan, resolveSettings } from './utils';


abstract class MathSettingModal<SettingsType> extends Modal {
    settings: SettingsType;

    constructor(
        app: App,
        public plugin: MathBooster,
        public callback?: (settings: SettingsType) => void,
    ) {
        super(app);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    addButton(buttonText: string) {
        const { contentEl } = this;
        new Setting(contentEl)
            .addButton((btn) => {
                btn.setButtonText(buttonText)
                    .setCta()
                    .onClick(() => {
                        this.close();
                        if (this.callback) {
                            this.callback(this.settings);
                        }
                    });
                btn.buttonEl.classList.add("insert-math-item-button");
            });

        const button = contentEl.querySelector(".insert-math-item-button");
        const settingTextboxes = contentEl.querySelectorAll("input");
        if (button) {
            settingTextboxes.forEach((textbox) => {
                /**
                 * 'keypress' is deprecated, but here we need to use it.
                 * 'keydown' causes a serious inconvenience at least for Japanese users.
                 * See https://qiita.com/ledsun/items/31e43a97413dd3c8e38e
                 */
                this.plugin.registerDomEvent(textbox, "keypress", (event) => {
                    if (event.key === "Enter") {
                        (button as HTMLElement).click();
                    }
                });
            });
        }
    }
}


export class TheoremCalloutModal extends MathSettingModal<MathSettings> {
    defaultSettings: Required<MathContextSettings>;

    constructor(
        app: App,
        plugin: MathBooster,
        public file: TFile,
        callback: (settings: MathSettings) => void,
        public buttonText: string,
        public headerText: string,
        public currentCalloutSettings?: MathSettings,
    ) {
        super(app, plugin, callback);
    }

    resolveDefaultSettings(currentFile: TAbstractFile) {
        // The if statement is redundant, but probably necessary for the Typescript compiler to work
        if (this.currentCalloutSettings === undefined) {
            this.defaultSettings = resolveSettings(this.currentCalloutSettings, this.plugin, currentFile)
        } else {
            this.defaultSettings = resolveSettings(this.currentCalloutSettings, this.plugin, currentFile)
        }
    }

    onOpen(): void {
        this.settings = this.currentCalloutSettings ?? {} as MathSettings;
        const { contentEl } = this;
        contentEl.empty();

        this.resolveDefaultSettings(this.file);

        if (this.headerText) {
            contentEl.createEl("h4", { text: this.headerText });
        }

        const helper = new TheoremCalloutSettingsHelper(contentEl, this.settings, this.defaultSettings, this.plugin, this.file);
        helper.makeSettingPane();

        new Setting(contentEl)
            .setName('Open local settings for the current note')
            .addButton((button) => {
                button.setButtonText("Open")
                    .onClick(() => {
                        const modal = new ContextSettingModal(
                            this.app,
                            this.plugin,
                            this.file,
                            undefined,
                            this
                        );
                        modal.open();
                    })
            });

        this.addButton(this.buttonText);
    }
}


export class ContextSettingModal extends MathSettingModal<MathContextSettings> {

    constructor(
        app: App,
        plugin: MathBooster,
        public file: TAbstractFile,
        callback?: (settings: MathContextSettings) => void,
        public parent?: TheoremCalloutModal | undefined
    ) {
        super(app, plugin, callback);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { text: 'Local settings for ' + this.file.path });
        contentEl.createDiv({
            text: "If you want the change to apply to the entire vault, go to the plugin settings.",
            cls: ["setting-item-description", "math-booster-setting-item-description"],
        });

        if (this.plugin.settings[this.file.path] === undefined) {
            this.plugin.settings[this.file.path] = {} as MathContextSettings;
        }

        const defaultSettings = this.file.parent ? resolveSettings(undefined, this.plugin, this.file.parent) : DEFAULT_SETTINGS;

        const contextSettingsHelper = new MathContextSettingsHelper(contentEl, this.plugin.settings[this.file.path], defaultSettings, this.plugin, this.file);
        contextSettingsHelper.makeSettingPane();

        if (!(this.file instanceof TFolder && this.file.isRoot())) {
            new ProjectSettingsHelper(contentEl, this).makeSettingPane();
        }

        this.addButton('Save');
    }

    onClose(): void {
        super.onClose();

        this.plugin.saveSettings();
        this.app.metadataCache.trigger("math-booster:local-settings-updated", this.file);

        if (this.parent) {
            this.parent.open();
        }
    }
}


abstract class FileSuggestModal extends FuzzySuggestModal<TAbstractFile> {

    constructor(app: App, public plugin: MathBooster) {
        super(app);
    }

    getItems(): TAbstractFile[] {
        return this.app.vault
            .getAllLoadedFiles()
            .filter(this.filterCallback.bind(this));
    }

    getItemText(file: TAbstractFile): string {
        return file.path;
    }

    filterCallback(abstractFile: TAbstractFile): boolean {
        if (abstractFile instanceof TFile && abstractFile.extension != 'md') {
            return false;
        }
        if (abstractFile instanceof TFolder && abstractFile.isRoot()) {
            return false;
        }
        for (const path of this.plugin.excludedFiles) {
            const file = this.app.vault.getAbstractFileByPath(path)
            if (file && isEqualToOrChildOf(abstractFile, file)) {
                return false
            }
        }
        return true;
    }
}



export class LocalContextSettingsSuggestModal extends FileSuggestModal {
    constructor(app: App, plugin: MathBooster, public settingTab: MathSettingTab) {
        super(app, plugin);
    }

    onChooseItem(file: TAbstractFile, evt: MouseEvent | KeyboardEvent) {
        const modal = new ContextSettingModal(this.app, this.plugin, file);
        modal.open();
    }
}



export class FileExcludeSuggestModal extends FileSuggestModal {
    constructor(app: App, plugin: MathBooster, public manageModal: ExcludedFileManageModal) {
        super(app, plugin);
    }

    onChooseItem(file: TAbstractFile, evt: MouseEvent | KeyboardEvent) {
        this.plugin.excludedFiles.push(file.path);
        this.manageModal.newDisplay();
    }

    filterCallback(abstractFile: TAbstractFile): boolean {
        for (const path in this.plugin.settings) {
            if (path == abstractFile.path) {
                return false;
            }
        }
        return super.filterCallback(abstractFile);
    }
}


export class ExcludedFileManageModal extends Modal {
    constructor(app: App, public plugin: MathBooster) {
        super(app);
    }

    onOpen() {
        this.newDisplay();
    }

    async newDisplay() {
        await this.plugin.saveSettings();
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Excluded files/folders' });

        new Setting(contentEl)
            .setName('The files/folders in this list and their descendants will be excluded from suggestion for local settings.')
            .addButton((btn) => {
                btn.setIcon("plus")
                    .onClick((event) => {
                        new FileExcludeSuggestModal(this.app, this.plugin, this).open();
                    });
            });

        if (this.plugin.excludedFiles.length) {
            const list = contentEl.createEl('ul');
            for (const path of this.plugin.excludedFiles) {
                const item = list.createEl('li').createDiv();
                new Setting(item).setName(path).addExtraButton((btn) => {
                    btn.setIcon('x').onClick(async () => {
                        this.plugin.excludedFiles.remove(path);
                        this.newDisplay();
                        await this.plugin.saveSettings();
                    });
                });
            }
        }

    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}


export class DependencyNotificationModal extends Modal {
    constructor(public plugin: MathBooster) {
        super(plugin.app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h3', { 
            text: `Welcome to ${this.plugin.manifest.name}`
        });

        contentEl.createDiv({
            text: `${this.plugin.manifest.name} requires the following plugins to work properly. Disable it once, install/update & enable the dependencies and enable it again.`,
            attr: { style: "margin-bottom: 1em;"}
        });

        // Validity indicator is taken from the Latex Suite plugin (https://github.com/artisticat1/obsidian-latex-suite/blob/a5914c70c16d5763a182ec51d9716110b40965cf/src/settings.ts)
        for (const depenedency of [
            {id: "mathlinks", name: "MathLinks"}, 
            {id: "dataview", name: "Dataview"}
        ]) {
            const depPlugin = this.app.plugins.getPlugin(depenedency.id);
            const requiredVersion = this.plugin.dependencies[depenedency.id];
            const isValid = depPlugin && !isPluginOlderThan(depPlugin, requiredVersion);
            const setting = new Setting(contentEl)
                .setName(depenedency.name)
                .addExtraButton((button) => {
                    button.setIcon(isValid ? "checkmark" : "cross");
                    const el = button.extraSettingsEl;
                    el.addClass("math-booster-dependency-validation");
                    el.removeClass(isValid ? "invalid" : "valid");
                    el.addClass(isValid ? "valid" : "invalid");
                });
            setting.descEl.createDiv(
                {text: 
                    `Required version: ${requiredVersion}+ / `
                    + (depPlugin ? `Currently installed: ${depPlugin.manifest.version}`
                    : `Not installed or enabled`)
                }
            );
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
