<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
</script>

<!-- Four connection points, one per side; the JSON Canvas format names an arrow's side. Shown on hover or selection. -->
<Handle id="top" type="source" position={Position.Top} />
<Handle id="right" type="source" position={Position.Right} />
<Handle id="bottom" type="source" position={Position.Bottom} />
<Handle id="left" type="source" position={Position.Left} />
