import type {
  CmsHeroContent,
  CmsHowItWorksStep,
  CmsIntroBlock,
  CmsReassuranceItem,
} from '../../supabase/types/cms-content';

export const CONCEPT_SLUG = 'concept';

export interface ConceptPageContent {
  title: string;
  hero: CmsHeroContent;
  introBlocks: CmsIntroBlock[];
  howItWorks: CmsHowItWorksStep[];
  reassuranceItems: CmsReassuranceItem[];
}

export const DEFAULT_CONCEPT_CONTENT: ConceptPageContent = {
  title: 'Notre Concept',
  hero: {
    title: 'Labs Food',
    subtitle: 'Un chef professionnel à domicile pour des moments gourmands sans effort.',
    image: { src: '', alt: 'Labs Food — chef à domicile' },
  },
  introBlocks: [
    {
      title: 'Notre vision',
      body: 'Labs Food connecte des chefs professionnels et des clients qui souhaitent vivre une expérience culinaire premium à domicile, avec un parcours de réservation simple et transparent.',
    },
    {
      title: 'Notre proposition de valeur',
      body: 'Menus soignés, service à domicile, hygiène irréprochable et personnalisation selon vos préférences — le tout piloté depuis une seule plateforme.',
    },
  ],
  howItWorks: [
    {
      title: 'Choisissez votre menu',
      description:
        'Parcourez les offres et sélectionnez le menu adapté à votre occasion.',
      image: { src: '', alt: 'Choix du menu' },
    },
    {
      title: 'Réservez votre créneau',
      description: 'Indiquez la date, l’heure et l’adresse pour confirmer la prestation.',
      image: { src: '', alt: 'Réservation en ligne' },
    },
    {
      title: 'Service à domicile',
      description: 'Le chef se déplace chez vous et réalise la prestation de A à Z.',
      image: { src: '', alt: 'Chef à domicile' },
    },
  ],
  reassuranceItems: [
    {
      title: 'Hygiène',
      description:
        'Processus et standards alignés sur les exigences d’un service traiteur professionnel.',
      icon: 'hygiene',
    },
    {
      title: 'Chef professionnel',
      description:
        'Des profils vérifiés et expérimentés pour garantir la qualité en cuisine.',
      icon: 'chef',
    },
    {
      title: 'Personnalisation',
      description:
        'Allergies, préférences et contraintes prises en compte avant la prestation.',
      icon: 'personalization',
    },
  ],
};
