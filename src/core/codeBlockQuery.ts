import { HeatmapColorModes, HeatmapConfig } from "@/defs/types";
import jsep from "jsep";
import { DailyActivity } from "@/defs/types";
import {
	isValidCalculationType,
	isValidTargetCount,
	isValidColoringMode,
} from "@/utils/utils";
import { SlotConfig, TargetCount, CalculationType } from "@/defs/types";
import { useStore } from "./store";

// Register custom binary operators once at module load.  These calls are
// idempotent but we used to do them inside parseQueryToJSEP on every
// markdown re-render.
jsep.addBinaryOp("starts_with", 6);
jsep.addBinaryOp("STARTS_WITH", 6);
jsep.addBinaryOp("contains", 6);
jsep.addBinaryOp("CONTAINS", 6);

// AST cache for heatmap filter expressions.  The AST is a pure function
// of the source text, so caching by string makes the `query` prop stable
// across markdown re-renders.  Without this, every theme switch / layout
// change would re-parse and yield a fresh AST reference, which then
// invalidated Heatmap's compiledEvaluator useMemo on every keystroke.
// 256 entries is plenty for any realistic vault.
const MAX_AST_CACHE = 256;
const filterAstCache = new Map<string, any | null>();

export function parseSlotQuery(query: string): SlotConfig[] {
	// returns a SlotConfig[]?
	const arrayOfLines = query.match(/[^\r\n]+/g);
	if (!arrayOfLines || arrayOfLines.length == 0) return [];

	let slots: SlotConfig[] = [];

	for (let i = 0; i < arrayOfLines.length; i++) {
		const parts = arrayOfLines[i].replace(/ /g, "").split(",");

		let type = parts[0];
		let calc = CalculationType.TOTAL;

		if (!isValidTargetCount(type)) {
			console.error("Invalid Type on Slots Codeblock: ", type);
			continue;
			// deveria mostrar o erro no codeblock mesmo, mas nao sei fazer isso ainda
		}

		if (parts[2] && isValidCalculationType(parts[2])) {
			calc = parts[2];
		}

		slots.push({
			index: i,
			option: type as TargetCount,
			calc: (calc as CalculationType) ?? CalculationType.TOTAL,
		});
	}

	return slots;
}

/**
 * Parse a heatmap filter expression into a jsep AST, with caching.
 * Returns undefined when there's no filter, null when parsing failed.
 */
function getFilterAst(filterText: string): any | undefined | null {
	const trimmed = filterText?.trim();
	if (!trimmed) return undefined;

	if (filterAstCache.has(trimmed)) {
		return filterAstCache.get(trimmed);
	}

	const normalized = normalizeLogicalOperators(trimmed);
	let ast: any = null;
	try {
		ast = jsep(normalized);
	} catch (error) {
		console.error("Error parsing filter expression:", error);
		console.error("Normalized query:", normalized);
		// null = "valid but empty filter that matches everything"
		ast = null;
	}

	if (filterAstCache.size >= MAX_AST_CACHE) {
		// Drop the oldest entry (Map preserves insertion order).
		const firstKey = filterAstCache.keys().next().value;
		if (firstKey !== undefined) filterAstCache.delete(firstKey);
	}
	filterAstCache.set(trimmed, ast);
	return ast;
}

export function parseQueryToJSEP(query: string) {
	const { filterText, optionsText } = splitFilterAndOptions(query);
	const parsed = getFilterAst(filterText);

	// Build a mutable copy of the user's heatmap config.  The original
	// was being deep-cloned via structuredClone on every call; we only
	// mutate hideMonthLabels, hideWeekdayLabels, intensityStops fields,
	// intensityMode, roundCells, startDate, and numberOfWeeks — so a
	// shallow clone + one nested clone of intensityStops is sufficient.
	const base = useStore.getState().settings.heatmapConfig;
	const config: HeatmapConfig = {
		...base,
		intensityStops: { ...base.intensityStops },
	};
	config.hideMonthLabels = false;
	config.hideWeekdayLabels = false;

	if (optionsText) {
		const arrayOfLines = optionsText.match(/[^\r\n]+/g);
		if (arrayOfLines && arrayOfLines.length >= 1) {
			/** defaults to user settings to define heatmapconfig */

			for (let i = 0; i < arrayOfLines.length; i++) {
				const line = arrayOfLines[i];
				const firstSpace = line.indexOf(" ");
				let keyword;
				let details;

				if (firstSpace !== -1) {
					keyword = line.slice(0, firstSpace);
					details = line.slice(firstSpace + 1);
				} else {
					keyword = line;
					details = "";
				}

				switch (keyword) {
					case "OPTIONS":
						break;
					case "HIDE":
						if (details) {
							const items = details.replace(/ /g, "").split(",");
							for (let j = 0; j < items.length; j++) {
								switch (items[j]) {
									case "month_labels":
										config.hideMonthLabels = true;
										break;
									case "weekday_labels":
										config.hideWeekdayLabels = true;
										break;
								}
							}
						}
						break;
					case "COLORING_MODE":
						if (details && isValidColoringMode(details.trim())) {
							config.intensityMode = details as HeatmapColorModes;
						}
						break;
					case "STOPS":
						if (details) {
							const stops = details.replace(/ /g, "").split(",");
							if (stops.length == 1) {
								config.intensityStops.high = Number(stops[0]);
							} else if (stops.length == 2) {
								config.intensityStops.low = Number(stops[0]);
								config.intensityStops.high = Number(stops[1]);
							} else if (stops.length == 3) {
								config.intensityStops.low = Number(stops[0]);
								config.intensityStops.medium = Number(stops[1]);
								config.intensityStops.high = Number(stops[2]);
							}
						}
						break;
					case "SQUARED_CELLS":
						config.roundCells = false;
						break;
					case "START_DATE":
						config.startDate = details;
						break;
					case "ROUNDED_CELLS":
						config.roundCells = true;
						break;
					case "WEEKS":
						config.numberOfWeeks = Number(details) || 20;
				}
			}
		}
	}

	return {
		filter: parsed,
		options: config,
	};
}

function normalizeLogicalOperators(input: string): string {
	return input.replace(/\bAND\b/gi, "&&").replace(/\bOR\b/gi, "||");
}

export function compileEvaluator(node: any): (entry: DailyActivity) => boolean {
	if (!node) {
		return () => true;
	}

	return (entry: DailyActivity) => {
		try {
			return interpretNode(node, entry);
		} catch (error) {
			console.error("Filter evaluation error:", error);
			return false;
		}
	};
}

function splitFilterAndOptions(input: string) {
	const lines = input.split("\n");
	const sectionHeaderPattern = /^[A-Z_]+(?:\s|$)/;

	let filterLines: string[] = [];
	let optionsLines: string[] = [];

	let inOptions = false;

	for (const line of lines) {
		const trimmedLine = line.trim();

		// Skip empty lines
		if (!trimmedLine) {
			if (inOptions) {
				optionsLines.push(line);
			} else {
				filterLines.push(line);
			}
			continue;
		}

		// Check if this line starts a new section (all caps words)
		if (!inOptions && sectionHeaderPattern.test(trimmedLine)) {
			inOptions = true;
		}

		if (inOptions) {
			optionsLines.push(line);
		} else {
			filterLines.push(line);
		}
	}

	return {
		filterText: filterLines.join("\n").trim(),
		optionsText: optionsLines.join("\n").trim(),
	};
}

function interpretNode(node: any, entry: DailyActivity): any {
	if (!node) return true;

	switch (node.type) {
		case "Literal": {
			let value = node.value;
			if (typeof value === "string") {
				value = value.startsWith("/") ? value.substring(1) : value;
			}
			return value;
		}
		case "Identifier": {
			return entry &&
				entry[node.name as keyof DailyActivity] !== undefined
				? entry[node.name as keyof DailyActivity]
				: "";
		}
		case "BinaryExpression": {
			const left = interpretNode(node.left, entry);
			const right = interpretNode(node.right, entry);

			switch (node.operator) {
				case "&&":
					return left && right;
				case "||":
					return left || right;
				case "starts_with":
				case "STARTS_WITH":
					return String(left).startsWith(String(right));
				case "contains":
				case "CONTAINS":
					return String(left).includes(String(right));
				case "==":
					return left === right;
				case "!=":
					return left !== right;
				case ">":
					return Number(left) > Number(right);
				case "<":
					return Number(left) < Number(right);
				case ">=":
					return Number(left) >= Number(right);
				case "<=":
					return Number(left) <= Number(right);
				default:
					console.warn(`Unsupported operator: ${node.operator}`);
					return true;
			}
		}
		case "UnaryExpression": {
			const argument = interpretNode(node.argument, entry);
			switch (node.operator) {
				case "!":
					return !argument;
				default:
					console.warn(
						`Unsupported unary operator: ${node.operator}`,
					);
					return argument;
			}
		}
		default:
			console.warn(`Unsupported node type: ${node.type}`);
			return true;
	}
}
