import os
import uuid
import traceback
from typing import Sequence


import click
from sqlalchemy.future import select
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from oss.src.utils.env import env
from oss.src.services import db_manager
from oss.src.resources.evaluators.evaluators import get_builtin_evaluators
from oss.src.models.deprecated_models import (
    ProjectScopedAppDB as AppDB,
    DeprecatedProjectDB as ProjectDB,
    DeprecatedAppVariantDB as AppVariantDB,
    DeprecatedEvaluationScenarioDB as EvaluationScenarioDB,
    DeprecatedHumanEvaluationScenarioDB as HumanEvaluationScenarioDB,
    DeprecatedHumanEvaluationDB as HumanEvaluationDB,
    DeprecatedEvaluatorConfigDBwProject as EvaluatorConfigDB,
    DeprecatedEvaluationDB as EvaluationDB,
    DeprecatedAppVariantRevisionsDB as AppVariantRevisionsDB,
    DeprecatedAppEnvironmentRevisionDB as AppEnvironmentRevisionDB,
)
from oss.src.models.db_models import (
    VariantBaseDB,
    DeploymentDB,
    AppEnvironmentDB,
    TestsetDB,
)


BATCH_SIZE = 1000
MODELS = [
    AppDB,
    AppVariantDB,
    AppVariantRevisionsDB,
    VariantBaseDB,
    DeploymentDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    EvaluationScenarioDB,
    EvaluationDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    TestsetDB,
]


def get_default_projects(session):
    query = session.execute(select(ProjectDB).filter_by(is_default=True))
    return query.scalars().all()


def check_for_multiple_default_projects(session: Session) -> Sequence[ProjectDB]:
    default_projects = get_default_projects(session)
    if len(default_projects) > 1:
        raise ValueError(
            "Multiple default projects found. Please ensure only one exists."
        )
    return default_projects


def create_default_project():
    PROJECT_NAME = "Default"
    engine = create_engine(env.postgres.uri_core)
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_projects = check_for_multiple_default_projects(session)
            if len(default_projects) == 0:
                new_project = ProjectDB(project_name=PROJECT_NAME, is_default=True)
                session.add(new_project)
                session.commit()

        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR creating default project: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e


def add_completion_testset_to_project(session: Session, project_id: str):
    try:
        json_path = os.path.join(
            db_manager.PARENT_DIRECTORY,
            "resources",
            "default_testsets",
            "completion_testset.json",
        )
        if os.path.exists(json_path):
            csvdata = db_manager.get_json(json_path)
            testset = {
                "name": "completion_testset",
                "csvdata": csvdata,
            }
            testset_db = TestsetDB(
                **testset,
                project_id=uuid.UUID(project_id),
            )

            session.add(testset_db)
            session.commit()

        print("Added completion testset to project.")
    except Exception as e:
        print(f"An error occurred in adding the default testset: {e}")


def add_default_evaluators_to_project(session: Session, project_id: str):
    try:
        builtin_evaluators = get_builtin_evaluators()
        direct_use_evaluators = [
            evaluator for evaluator in builtin_evaluators if evaluator.direct_use
        ]

        for evaluator in direct_use_evaluators:
            settings_values = {
                setting_name: setting.get("default")
                for setting_name, setting in evaluator.settings_template.items()
                if setting.get("ground_truth_key") is True
                and setting.get("default", "")
            }

            for setting_name, default_value in settings_values.items():
                assert default_value != "", (
                    f"Default value for ground truth key '{setting_name}' in Evaluator is empty"
                )

            assert hasattr(evaluator, "name") and hasattr(evaluator, "key"), (
                f"'name' and 'key' does not exist in the evaluator: {evaluator}"
            )

            evaluator_config = EvaluatorConfigDB(
                project_id=uuid.UUID(project_id),
                name=evaluator.name,
                evaluator_key=evaluator.key,
                settings_values=settings_values,
            )
            session.add(evaluator_config)

        session.commit()

        print("Added default evaluators to project.")
    except Exception as e:
        print(f"An error occurred in adding default evaluators: {e}")


def remove_default_project():
    engine = create_engine(env.postgres.uri_core)
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_projects = check_for_multiple_default_projects(session)
            if len(default_projects) == 0:
                click.echo(
                    click.style("No default project found to remove.", fg="yellow")
                )
                return

            session.delete(default_projects[0])

            session.commit()

            click.echo(click.style("Default project removed successfully.", fg="green"))

        except Exception as e:
            session.rollback()
            click.echo(click.style(f"ERROR: {traceback.format_exc()}", fg="red"))
            raise e


def add_project_id_to_db_entities():
    engine = create_engine(env.postgres.uri_core)
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            default_project = check_for_multiple_default_projects(session)[0]
            for model in MODELS:
                offset = 0
                while True:
                    records = (
                        session.execute(
                            select(model)
                            .where(model.project_id == None)  # noqa: E711
                            .offset(offset)
                            .limit(BATCH_SIZE)
                        )
                        .scalars()
                        .all()
                    )
                    if not records:
                        break

                    # Update records with default project_id
                    for record in records:
                        record.project_id = default_project.id

                    session.commit()
                    offset += BATCH_SIZE

            # add default testset and evaluators
            add_completion_testset_to_project(
                session=session,
                project_id=str(default_project.id),
            )
            add_default_evaluators_to_project(
                session=session, project_id=str(default_project.id)
            )
        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR adding project_id to db entities: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e


def remove_project_id_from_db_entities():
    engine = create_engine(env.postgres.uri_core)
    sync_session = sessionmaker(engine, expire_on_commit=False)

    with sync_session() as session:
        try:
            for model in MODELS:
                offset = 0
                while True:
                    records = (
                        session.execute(
                            select(model)
                            .where(model.project_id != None)  # noqa: E711
                            .offset(offset)
                            .limit(BATCH_SIZE)
                        )
                        .scalars()
                        .all()
                    )
                    if not records:
                        break

                    # Update records project_id column with None
                    for record in records:
                        record.project_id = None

                    session.commit()
                    offset += BATCH_SIZE

        except Exception as e:
            session.rollback()
            click.echo(
                click.style(
                    f"ERROR removing project_id to db entities: {traceback.format_exc()}",
                    fg="red",
                )
            )
            raise e
