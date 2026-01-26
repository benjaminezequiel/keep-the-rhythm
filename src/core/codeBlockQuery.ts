import { HeatmapColorModes, HeatmapConfig } from "@/defs/types";
import jsep, { Expression } from "jsep";
import { DailyActivity } from "@/db/types";
import {
  isValidCalculationType,
  isValidTargetCount,
  isValidUnit,
  isValidColoringMode,
} from "@/utils/utils";
import { SlotConfig, TargetCount, Unit, CalculationType } from "@/defs/types";
import { state } from "./pluginState";

export function parseSlotQuery(query: string): SlotConfig[] {
  // returns a SlotConfig[]?
  const arrayOfLines = query.match(/[^\r\n]+/g);
  if (!arrayOfLines || arrayOfLines.length == 0) return [];

  let slots: SlotConfig[] = [];

  for (let i = 0; i < arrayOfLines.length; i++) {
    const parts = arrayOfLines[i].replace(/ /g, "").split(",");

    let type = parts[0];
    let unit = Unit.WORD;
    let calc = CalculationType.TOTAL;

    if (!isValidTargetCount(type)) {
      console.error("Invalid Type on Slots Codeblock");
      return [];
      // deveria mostrar o erro no codeblock mesmo, mas nao sei fazer isso ainda
    }

    if (parts[1] && isValidUnit(parts[1])) {
      unit = parts[1];
    }
    if (parts[2] && isValidCalculationType(parts[2])) {
      calc = parts[2];
    }

    slots.push({
      index: i,
      option: type as TargetCount,
      unit: unit as Unit,
      calc: (calc as CalculationType) ?? CalculationType.TOTAL,
    });
  }

  return slots;
}

export function parseQueryToJSEP(query: string) {
  // Configure jsep with custom operators
  jsep.addBinaryOp("starts_with", 6);
  jsep.addBinaryOp("STARTS_WITH", 6);
  jsep.addBinaryOp("contains", 6);
  jsep.addBinaryOp("CONTAINS", 6);

  const { filterText, optionsText } = splitFilterAndOptions(query);
  let normalized = normalizeLogicalOperators(filterText);

  let parsed;
  let config: HeatmapConfig = structuredClone(
    state.plugin.data.settings.heatmapConfig,
  );
  config.hideMonthLabels = false;
  config.hideWeekdayLabels = false;

  if (filterText && filterText.trim()) {
    try {
      parsed = jsep(normalized);
    } catch (error) {
      console.error("Error parsing filter expression:", error);
      console.error("Normalized query:", normalized);
      // Return a valid but empty filter that matches everything
      parsed = null;
    }
  }

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
  // If no filter node, return a function that accepts everything
  if (!node) {
    return () => true;
  }

  try {
    const code = generateCode(node);
    const evaluatorFn = new Function(
      "entry",
      `
			try {
				return ${code};
			} catch (error) {
				console.error("Filter evaluation error:", error);
				return false;
			}
		`,
    ) as (entry: DailyActivity) => boolean;

    return evaluatorFn;
  } catch (error) {
    console.error("Error compiling evaluator:", error);
    return () => true;
  }
}

export function generateCode(node: any): string {
  if (!node) {
    return "true";
  }

  switch (node.type) {
    case "Literal":
      let value = node.value;
      if (typeof value === "string") {
        // Handle regex-like strings by removing leading slash
        value = value.startsWith("/") ? value.substring(1) : value;
      }
      return JSON.stringify(value);
    case "Identifier":
      // Ensure the property exists on entry object
      return `(entry && entry.${node.name} !== undefined ? entry.${node.name} : "")`;
    case "BinaryExpression":
      let left = generateCode(node.left);
      let right = generateCode(node.right);

      switch (node.operator) {
        case "&&":
          return `(${left} && ${right})`;
        case "||":
          return `(${left} || ${right})`;
        case "starts_with":
          return `(String(${left}).startsWith(String(${right})))`;
        case "STARTS_WITH":
          return `(String(${left}).startsWith(String(${right})))`;
        case "contains":
          return `(String(${left}).includes(String(${right})))`;
        case "CONTAINS":
          return `(String(${left}).includes(String(${right})))`;
        case "==":
          return `(${left} === ${right})`;
        case "!=":
          return `(${left} !== ${right})`;
        case ">":
          return `(Number(${left}) > Number(${right}))`;
        case "<":
          return `(Number(${left}) < Number(${right}))`;
        case ">=":
          return `(Number(${left}) >= Number(${right}))`;
        case "<=":
          return `(Number(${left}) <= Number(${right}))`;
        default:
          console.warn(`Unsupported operator: ${node.operator}`);
          return "true";
      }
    case "UnaryExpression":
      const argument = generateCode(node.argument);
      switch (node.operator) {
        case "!":
          return `!(${argument})`;
        default:
          console.warn(`Unsupported unary operator: ${node.operator}`);
          return argument;
      }
    default:
      console.warn(`Unsupported node type: ${node.type}`);
      return "true";
  }
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
