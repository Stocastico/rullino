// The edit document: plain JSON. The browser previews it, the route handler renders it, and nothing
// else is shared between the two sides. (Copy a real one from the playground's Code button.)
export const makeEdit = ({ ev, blur }) => ({
  version: 2,
  steps: [
    { filter: 'exposure', params: { ev } },
    ...(blur > 0 ? [{ filter: 'gaussianBlur', params: { sigma: blur } }] : []),
  ],
  output: { format: 'jpeg', quality: 0.9, longSide: 1600 },
});
