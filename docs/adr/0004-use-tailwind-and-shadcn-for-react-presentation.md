# Use Tailwind and shadcn for React presentation

TorobRent uses semantic Tailwind theme utilities and locally generated shadcn primitives as the
primary presentation vocabulary for its React frontend, with no authored component class or ID
selectors. This trades bespoke semantic stylesheets for consistent, colocated composition and an
inspectable local component layer; native semantic HTML remains appropriate where a registry
primitive adds no value, and the customized Django admin remains outside this frontend boundary.
