"""create free plans

Revision ID: 7990f1e12f47
Revises: 12f477990f1e
Create Date: 2025-01-25 16:51:06.233811

"""

from typing import Sequence, Union
from datetime import datetime, timezone
from time import time

from alembic import context

from sqlalchemy import Connection, func, insert, select, update
from sqlalchemy.orm import load_only

import stripe

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.models.db_models import UserDB
from oss.src.models.db_models import AppDB
from ee.src.models.db_models import OrganizationMemberDB
from oss.src.models.db_models import ProjectDB
from ee.src.models.extended.deprecated_models import DeprecatedOrganizationDB
from ee.src.dbs.postgres.subscriptions.dbes import SubscriptionDBE
from ee.src.dbs.postgres.meters.dbes import MeterDBE
from ee.src.core.subscriptions.types import FREE_PLAN
from ee.src.core.entitlements.types import Gauge

stripe.api_key = env.stripe.api_key

log = get_module_logger(__name__)

# revision identifiers, used by Alembic.
revision: str = "7990f1e12f47"
down_revision: Union[str, None] = "12f477990f1e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    try:
        session: Connection = context.get_bind()

        now = datetime.now(timezone.utc)

        # --> GET ORGANIZATION COUNT
        query = select(func.count()).select_from(DeprecatedOrganizationDB)

        nof_organizations = session.execute(query).scalar()
        # <-- GET ORGANIZATION COUNT

        # --> ITERATE OVER ORGANIZATION BATCHES
        organization_batch_size = 100
        organization_batch_index = 0

        while True:
            # --> GET ORGANIZATION BATCH
            query = (
                select(DeprecatedOrganizationDB)
                .options(
                    load_only(
                        DeprecatedOrganizationDB.id, DeprecatedOrganizationDB.owner
                    )
                )
                .limit(organization_batch_size)
                .offset(organization_batch_index * organization_batch_size)
            )

            organizations = session.execute(query).all()

            organization_batch_index += 1

            if not organizations:
                break
            # <-- GET ORGANIZATION BATCH

            # --> ITERATE OVER ORGANIZATIONS
            for i, organization in enumerate(organizations):
                log.info(
                    " %s / %s - %s",
                    (organization_batch_index - 1) * organization_batch_size + i + 1,
                    nof_organizations,
                    organization.id,
                )

                ti = time()

                # xti = time()
                # --> GET ORGANIZATION INFO
                owner = organization.owner

                if not owner:
                    continue

                query = select(UserDB).where(
                    UserDB.id == owner,
                )

                user = session.execute(query).first()

                if not user:
                    continue

                email = user.email

                if not email:
                    continue
                # <-- GET ORGANIZATION INFO
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - GET ORGANIZATION INFO: %s ms", int(xdt * 1000))

                # xti = time()
                # --> CHECK IF SUBSCRIPTION EXISTS
                organization_id = organization.id
                customer_id = None
                subscription_id = None
                plan = FREE_PLAN
                active = True
                anchor = now.day

                subscription_exists = (
                    session.execute(
                        select(SubscriptionDBE).where(
                            SubscriptionDBE.organization_id == organization_id,
                        )
                    )
                    .scalars()
                    .first()
                )
                # <-- CHECK IF SUBSCRIPTION EXISTS
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - CHECK IF SUBSCRIPTION EXISTS: %s ms", int(xdt * 1000))

                # xti = time()
                # --> CREATE OR UPDATE SUBSCRIPTION
                if not subscription_exists:
                    query = insert(SubscriptionDBE).values(
                        organization_id=organization_id,
                        subscription_id=subscription_id,
                        customer_id=customer_id,
                        plan=plan.value,
                        active=active,
                        anchor=anchor,
                    )

                    session.execute(query)
                else:
                    query = (
                        update(SubscriptionDBE)
                        .where(
                            SubscriptionDBE.organization_id == organization_id,
                        )
                        .values(
                            subscription_id=subscription_id,
                            customer_id=customer_id,
                            plan=plan.value,
                            active=active,
                            anchor=anchor,
                        )
                    )

                    session.execute(query)
                # <-- CREATE OR UPDATE SUBSCRIPTION
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - CREATE OR UPDATE SUBSCRIPTION: %s ms", int(xdt * 1000))

                # xti = time()
                # --> GET ORGANIZATION MEMBERS
                query = (
                    select(func.count())
                    .select_from(OrganizationMemberDB)
                    .where(
                        OrganizationMemberDB.organization_id == organization.id,
                    )
                )

                nof_members = session.execute(query).scalar()
                # <-- GET ORGANIZATION MEMBERS
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - GET ORGANIZATION MEMBERS: %s ms", int(xdt * 1000))

                # xti = time()
                # --> CHECK IF USERS METER EXISTS
                key = Gauge.USERS
                value = nof_members
                synced = 0
                # organization_id = organization_id
                year = 0
                month = 0

                users_meter_exists = (
                    session.execute(
                        select(MeterDBE).where(
                            MeterDBE.organization_id == organization_id,
                            MeterDBE.key == key,
                            MeterDBE.year == year,
                            MeterDBE.month == month,
                        )
                    )
                    .scalars()
                    .first()
                )
                # <-- CHECK IF USERS METER EXISTS
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - CHECK IF USERS METER EXISTS: %s ms", int(xdt * 1000))

                # xti = time()
                # --> CREATE OR UPDATE USERS METER
                if not users_meter_exists:
                    query = insert(MeterDBE).values(
                        organization_id=organization_id,
                        key=key,
                        year=year,
                        month=month,
                        value=value,
                        synced=synced,
                    )

                    session.execute(query)
                else:
                    query = (
                        update(MeterDBE)
                        .where(
                            MeterDBE.organization_id == organization_id,
                            MeterDBE.key == key,
                            MeterDBE.year == year,
                            MeterDBE.month == month,
                        )
                        .values(
                            value=value,
                            synced=synced,
                        )
                    )

                    session.execute(query)
                # <-- CREATE OR UPDATE USERS METER
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - CREATE OR UPDATE USERS METER: %s ms", int(xdt * 1000))

                # xti = time()
                # --> GET ORGANIZATION PROJECTS
                query = select(ProjectDB).where(
                    ProjectDB.organization_id == organization_id,
                )

                projects = session.execute(query).all()
                # <-- GET ORGANIZATION PROJECTS
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - GET ORGANIZATION PROJECTS: %s ms", int(xdt * 1000))

                # xti = time()
                # --> ITERATE OVER PROJECTS
                value = 0

                for project in projects:
                    # --> GET PROJECT APPLICATIONS
                    query = select(AppDB).where(
                        AppDB.project_id == project.id,
                    )

                    apps = session.execute(query).scalars().all()
                    # <-- GET PROJECT APPLICATIONS

                    value += len(apps)
                # <-- ITERATE OVER PROJECTS
                # xtf = time()
                # xdt = xtf - xti
                # log.info(" - ITERATE OVER PROJECTS: %s ms", int(xdt * 1000))

                # xti = time()
                # --> CHECK IF APPLICATIONS METER EXISTS
                key = Gauge.APPLICATIONS
                # value = value
                synced = 0
                # organization_id = organization_id
                year = 0
                month = 0

                applications_meter_exists = (
                    session.execute(
                        select(MeterDBE).where(
                            MeterDBE.organization_id == organization_id,
                            MeterDBE.key == key,
                            MeterDBE.year == year,
                            MeterDBE.month == month,
                        )
                    )
                    .scalars()
                    .first()
                )
                # <-- CHECK IF APPLICATIONS METER EXISTS
                # xtf = time()
                # xdt = xtf - xti
                # log.info(
                #     " - CHECK IF APPLICATIONS METER EXISTS: %s ms", int(xdt * 1000)
                # )

                # xti = time()
                # --> CREATE OR UPDATE APPLICATIONS METER
                if not applications_meter_exists:
                    query = insert(MeterDBE).values(
                        organization_id=organization_id,
                        key=key,
                        year=year,
                        month=month,
                        value=value,
                        synced=synced,
                    )

                    session.execute(query)
                else:
                    query = (
                        update(MeterDBE)
                        .where(
                            MeterDBE.organization_id == organization_id,
                            MeterDBE.key == key,
                            MeterDBE.year == year,
                            MeterDBE.month == month,
                        )
                        .values(
                            value=value,
                            synced=synced,
                        )
                    )

                    session.execute(query)
                # <-- CREATE OR UPDATE APPLICATIONS METER
                # xtf = time()
                # xdt = xtf - xti
                # log.info(
                #     " - CREATE OR UPDATE APPLICATIONS METER: %s ms", int(xdt * 1000)
                # )

                tf = time()
                dt = tf - ti
                log.info(
                    " %s / %s - %s - %s ms",
                    (organization_batch_index - 1) * organization_batch_size + i + 1,
                    nof_organizations,
                    organization.id,
                    int(dt * 1000),
                )
            # <-- ITERATE OVER ORGANIZATIONS

        # <-- ITERATE OVER ORGANIZATION BATCHES
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error("Error during free plans migration: %s", e)
        session.rollback()
        raise e

    log.info("Free plans migration completed successfully.")


def downgrade() -> None:
    pass
