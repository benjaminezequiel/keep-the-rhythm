import { TFile } from "obsidian";

export function handleFileModify(file: TFile) {
	console.log(file.name + " modified");
}

export function handleFileDelete(file: TFile) {
	console.log(file.name + " deleted");
}

export function handleFileCreate(file: TFile) {
	console.log(file.name + " created");
}

export function handleFileRename(file: TFile) {
	console.log(file.name + " renamed");
}

export function handleFileOpen(file: TFile) {
	console.log(file.name + " opened");
}
