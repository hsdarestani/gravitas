def project_markdown(project, space_user):
    """Render the project sidecar with the complete Gravitas project-form state.

    Filesystem placement (the user's parent Space Category) deliberately lives
    in ProjectSpaceLink rather than this shared project metadata, because every
    project member can place the same project in a different personal Category.
    """
    from .space_fs import _meta_lines

    profile = getattr(project, 'platform_profile', None)
    lines = _meta_lines(
        'project', project.pk, project.title,
        workspace_id=project.workspace_id,
        owner_id=project.owner_id,
        space_user_id=space_user.pk,
        project_type=getattr(profile, 'category', ''),
        visibility=getattr(profile, 'visibility', ''),
        status=getattr(profile, 'status', ''),
        research_question=getattr(profile, 'research_question', ''),
        client_name=getattr(profile, 'client_name', ''),
        requester_name=getattr(profile, 'requester_name', ''),
        requester_email=getattr(profile, 'requester_email', ''),
        confidentiality=getattr(profile, 'confidentiality', ''),
        deadline=getattr(profile, 'deadline', None),
        budget=getattr(profile, 'budget', None),
        currency=getattr(profile, 'currency', ''),
        compensation_text=getattr(profile, 'compensation_text', ''),
        required_skills=getattr(profile, 'required_skills', []),
        application_open=getattr(profile, 'application_open', False),
        secure_data_room=getattr(profile, 'secure_data_room', False),
        allow_public_links=getattr(profile, 'allow_public_links', False),
        allow_downloads=getattr(profile, 'allow_downloads', True),
        external_access_expires_at=getattr(profile, 'external_access_expires_at', None),
        updated_at=project.updated_at.isoformat() if project.updated_at else '',
    )
    lines.extend([f'# {project.title}', '', project.description or '', ''])
    return '\n'.join(lines)
