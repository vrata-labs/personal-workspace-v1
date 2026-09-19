# Personal Workspace 0.3.0 Review Asset Notice

All geometry, scalar material tuning, lighting setup, panorama geometry, panorama pixels, generation scripts, baked-lighting inputs, and review imagery in this release are project-authored Vrata work. No downloaded assets, external source images, branding, private references, or third-party scene files are included.

The 4096x2048 city, park, water, skyline, mountain, sky, cloud, and sun panorama was generated deterministically from repository source code and fixed parameters. It is embedded as the sRGB texture of the only exterior panorama mesh. The panorama mesh is inward-visible and excluded from lightmap baking, collision, support analysis, and navigable room bounds.

The existing interior source and 2048x2048 baked irradiance atlas are inherited without modifying their historical files. The GLB remains a baked-pbr-v1 scene. The panorama adds 32 MiB of decoded RGBA texture memory; together with the 16 MiB lightmap, the documented decoded texture budget is 48 MiB. The GLB budget is 15 MiB and the compressed panorama budget is 2.5 MiB.

License reference: LicenseRef-Project-Authored-Pending-Human-Rights-Approval.

Human rights approval for the exact 0.3.0 panorama and combined release bytes is pending-human-rights-approval. Historical approval for earlier release bytes does not extend automatically to this new asset or release. Human visual acceptance is pending-human-acceptance. Status is review, isCurrent=false, and publicationReady=false. No production activation or publication approval is claimed.
