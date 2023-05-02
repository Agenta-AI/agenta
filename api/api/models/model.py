from mongoengine import Document, EmbeddedDocument, StringField, ObjectIdField, DateTimeField, IntField, ListField, ReferenceField, EmbeddedDocumentField, DictField


# class Experiment(Document):
#     name = StringField(required=True, unique=True)
#     description = StringField()


# class Chain(Document):
#     experiment = ReferenceField(Experiment, required=True)
#     name = StringField(required=True, unique_with='experiment')
#     configuration = DictField()


# class PromptTemplate(Document):
#     chain = ReferenceField(Chain, required=True)
#     name = StringField(required=True, unique_with='chain')
#     template = StringField(required=True)
#     order = IntField(required=True)


# class Result(EmbeddedDocument):
#     prompt_template = ReferenceField(PromptTemplate, required=True)
#     prompt = StringField(required=True)
#     response = StringField(required=True)
#     post_processed_response = StringField(required=True)


# class Run(Document):
#     experiment = ReferenceField(Experiment, required=True)
#     input = StringField(required=True)
#     timestamp = DateTimeField(required=True)
#     results = ListField(EmbeddedDocumentField(Result))


class LLMCall(Document):
    meta = {'collection': 'llm_call'}

    # run = ReferenceField(Run, required=True)
    # prompt_template = ReferenceField(PromptTemplate, required=True)
    prompt = ListField(required=True)
    output = StringField(required=True)
    parameters = DictField()
