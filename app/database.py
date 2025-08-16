from sqlalchemy import Column, Integer, String, Table, ForeignKey, UniqueConstraint, DateTime, func
from sqlalchemy.orm import relationship, declarative_base
from datetime import datetime

Base = declarative_base()

tags_table = Table(
    'image_tags', Base.metadata,
    Column('image_id', Integer, ForeignKey('images.id'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id'), primary_key=True)
)

# --- SQLAlchemy ORM Models ---

class Image(Base):
    __tablename__ = 'images'
    id = Column(Integer, primary_key=True)
    filename = Column(String, unique=True, nullable=False)
    sha256_hash = Column(String(64), unique=True, nullable=False, index=True)
    tags = relationship("Tag", secondary=tags_table, back_populates="images")

class Tag(Base):
    __tablename__ = 'tags'
    id = Column(Integer, primary_key=True)
    # The `name` column is no longer unique on its own.
    name = Column(String, nullable=False)
    # Tags are now categorized, with 'general' as the default.
    category = Column(String, nullable=False, default='general', server_default='general')
    # This timestamp tracks when a tag was last assigned to an image.
    last_used_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    images = relationship("Image", secondary=tags_table, back_populates="tags")
    # A tag is now defined by the unique combination of its name and category.
    __table_args__ = (UniqueConstraint('name', 'category', name='_name_category_uc'),)