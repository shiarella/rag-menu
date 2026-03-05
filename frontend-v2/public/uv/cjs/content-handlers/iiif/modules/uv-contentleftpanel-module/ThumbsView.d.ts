import { ViewingDirection } from "@iiif/vocabulary";
import { Thumb } from "manifesto.js";
import React from "react";
declare const Thumbnails: ({ onClick, onKeyDown, paged, selected, thumbs, viewingDirection, truncateThumbnailLabels, }: {
    onClick: (thumb: Thumb) => void;
    onKeyDown: (thumb: Thumb) => void;
    paged: boolean;
    selected: number[];
    thumbs: Thumb[];
    viewingDirection: ViewingDirection;
    truncateThumbnailLabels: boolean;
}) => React.JSX.Element;
export default Thumbnails;
