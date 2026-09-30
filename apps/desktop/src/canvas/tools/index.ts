import type { ToolId } from '../../state/ui';
import { ui } from '../../state/ui';
import type { Renderer } from '../Renderer';
import { CropTool } from './CropTool';
import { ArrowTool, LineTool, PixelateTool, ShapeTool, StampTool, StrokeTool } from './DrawTools';
import { SelectTool } from './SelectTool';
import { TextTool } from './TextTool';
import type { Tool } from './Tool';

export function createTool(id: ToolId, r: Renderer): Tool {
  switch (id) {
    case 'select':
      return new SelectTool(r);
    case 'arrow':
      return new ArrowTool(r);
    case 'text':
      return new TextTool(r);
    case 'shape': {
      const s = ui().shape;
      return s === 'line' ? new LineTool(r) : new ShapeTool(r, s);
    }
    case 'pen':
      return new StrokeTool(r, 'pen');
    case 'highlight':
      return new StrokeTool(r, 'highlight');
    case 'stamp':
      return new StampTool(r);
    case 'pixelate':
      return new PixelateTool(r);
    case 'crop':
      return new CropTool(r);
  }
}
