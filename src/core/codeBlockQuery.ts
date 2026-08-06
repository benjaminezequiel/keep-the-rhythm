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
const MAX_AST_CACHE = 32;
const filterAstCache = new Map<string, any | null>();

// Result cache for the full { filter, options } pair returned by
// parseQueryToJSEP.  Without this, every markdown re-render creates a
// new config object reference, which invalidates every useMemo in
// Heatmap that depends on heatmapConfig (getIntensityLevel,
// wrapperClasses, cellData, ...).  The cache key is the trimmed source
// text; the value carries the parsed AST plus the built HeatmapConfig.
const MAX_QUERY_CACHE = 32;
const queryResultCache = new Map<
	string,
	{ filter: any; options: HeatmapConfig }
>();

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

/**
 * Parse an options block into a complete HeatmapConfig, overriding the
 * base settings from store.  Caller is responsible for the final
 * immutable snapshot before caching.
 */
function buildOptionsConfig(optionsText: string): HeatmapConfig {
	const base = useStore.getState().settings.heatmapConfig;
	const config = structuredClone(base);
	config.hideMonthLabels = false;
	config.hideWeekdayLabels = false;
	if (!optionsText) return config;

	const arrayOfLines = optionsText.match(/[^\r\n]+/g);
	if (!arrayOfLines || arrayOfLines.length === 0) return config;

	for (const line of arrayOfLines) {
		const firstSpace = line.indexOf(" ");
		const keyword = firstSpace !== -1 ? line.slice(0, firstSpace) : line;
		const details = firstSpace !== -1 ? line.slice(firstSpace + 1) : "";

		switch (keyword) {
			case "OPTIONS":
				break;
			case "HIDE": {
				if (details) {
					for (const item of details.replace(/ /g, "").split(",")) {
						if (item === "month_labels") config.hideMonthLabels = true;
						else if (item === "weekday_labels")
							config.hideWeekdayLabels = true;
					}
				}
				break;
			}
			case "COLORING_MODE": {
				if (details && isValidColoringMode(details.trim())) {
					config.intensityMode = details as HeatmapColorModes;
				}
				break;
			}
			case "STOPS": {
				if (details) {
					const stops = details.replace(/ /g, "").split(",");
					if (stops.length === 1) {
						config.intensityStops.high = Number(stops[0]);
					} else if (stops.length === 2) {
						config.intensityStops.low = Number(stops[0]);
						config.intensityStops.high = Number(stops[1]);
					} else if (stops.length === 3) {
						config.intensityStops.low = Number(stops[0]);
						config.intensityStops.medium = Number(stops[1]);
						config.intensityStops.high = Number(stops[2]);
					}
				}
				break;
			}
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

	return config;
}


// Track the heatmapConfig reference so we can detect when settings change
// and invalidate the query result cache.
let cachedHeatmapConfigRef: HeatmapConfig | undefined = undefined;

export function parseQueryToJSEP(query: string) {
	const currentHeatmapConfig = useStore.getState().settings.heatmapConfig;
	// Invalidate cache when settings.heatmapConfig changes.
	if (currentHeatmapConfig !== cachedHeatmapConfigRef) {
		queryResultCache.clear();
		cachedHeatmapConfigRef = currentHeatmapConfig;
	}

	const trimmed = query.trim();
	if (queryResultCache.has(trimmed)) {
		return queryResultCache.get(trimmed);
	}

	const { filterText, optionsText } = splitFilterAndOptions(query);
	const parsed = getFilterAst(filterText);
	const options = buildOptionsConfig(optionsText);

	const result = {
		filter: parsed,
		options: options,
	};

	if (queryResultCache.size >= MAX_QUERY_CACHE) {
		const firstKey = queryResultCache.keys().next().value;
		if (firstKey !== undefined) queryResultCache.delete(firstKey);
	}
	queryResultCache.set(trimmed, result);
	return result;
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

function stripTrailingComment(line: string): string {
	const idx = line.indexOf("//");
	return idx === -1 ? line : line.slice(0, idx).trimEnd();
}

function splitFilterAndOptions(input: string) {
	const lines = input
		.split("\n")
		.map(line => stripTrailingComment(line));
	const sectionHeaderPattern = /^[A-Z_]+(?:\s|$)/;

	// Find the first section-header line; everything before it is filter,
	// everything from it onward is options.
	let splitIndex = lines.length;
	for (let i = 0; i < lines.length; i++) {
		if (sectionHeaderPattern.test(lines[i].trim())) {
			splitIndex = i;
			break;
		}
	}

	return {
		filterText: lines.slice(0, splitIndex).join("\n").trim(),
		optionsText: lines.slice(splitIndex).join("\n").trim(),
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
