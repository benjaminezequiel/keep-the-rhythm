import React from "react";
import type { DirectoryFilter } from "@/defs/types";

interface DirectoryFilterInfoProps {
  directoryFilter: DirectoryFilter;
}

const MAX_VALUE_LENGTH = 500;

const formatDirectoryList = (directories: string[]): string => {
  const joined = directories.join(", ");
  if (joined.length <= MAX_VALUE_LENGTH) return joined;
  return joined.slice(0, MAX_VALUE_LENGTH).trimEnd() + "...";
};

export const DirectoryFilterInfo = ({
  directoryFilter,
}: DirectoryFilterInfoProps) => {
  const { include, exclude } = directoryFilter;

  if (include.length === 0 && exclude.length === 0) {
    return null;
  }

  return (
    <div className="directoryFilterInfo">
      {include.length > 0 && (
        <div className="directoryFilterInfo__row">
          <span className="directoryFilterInfo__label">Include</span>
          <span className="directoryFilterInfo__value">
            {formatDirectoryList(include)}
          </span>
        </div>
      )}
      {exclude.length > 0 && (
        <div className="directoryFilterInfo__row">
          <span className="directoryFilterInfo__label">Exclude</span>
          <span className="directoryFilterInfo__value">
            {formatDirectoryList(exclude)}
          </span>
        </div>
      )}
    </div>
  );
};
