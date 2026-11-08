export function createElement(type, config = null, ...children) {
  const props = { ...config };
  const key = props.key === undefined ? null : String(props.key);
  delete props.key;
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return { type, key, props };
}
